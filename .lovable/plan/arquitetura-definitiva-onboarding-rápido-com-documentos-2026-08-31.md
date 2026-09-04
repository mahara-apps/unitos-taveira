# Arquitetura definitiva — Onboarding Rápido com documentos

Proposta técnica (sem implementação). Vale para qualquer instalação: nada depende de conta, chave ou configuração específica de um cliente.

## 1. Princípios

- A import run é a única fonte de verdade do progresso; o processo HTTP é descartável.
- Todo passo é um checkpoint persistido: reexecutar o passo já concluído é proibido, não apenas evitado.
- Nenhum estado "running" existe sem lease com validade; sem heartbeat, a run é recuperada.
- O consumidor da fila é um worker acionado por cron, não `waitUntil`.
- Fallback de LLM é por candidato, com requisição remontada para o dialeto do provider.

## 2. Estados da import_run

| Estado | Significado |
|---|---|
| `queued` | trabalho pendente, ninguém detém lease |
| `leased` | worker detém lease válida (substitui o antigo "running" sem dono) |
| `paused` | interrompido por causa não transitória do provider (crédito/limite/config) |
| `needs_input` | falta ação humana (arquivo ilegível, sem texto extraível) |
| `proposed` | proposta pronta para revisão campo a campo |
| `applying` | aplicação idempotente em andamento |
| `applied` | terminal de sucesso |
| `failed` | terminal recuperável por retry explícito |
| `canceled` | terminal por decisão do usuário |
| `expired` | lease morta e tentativas esgotadas (terminal, libera o índice) |

Transições válidas:

```text
queued  -> leased | canceled
leased  -> queued (heartbeat perdido / backoff) | paused | needs_input
         | proposed | failed | expired
paused  -> queued (retomada do dono ou probe) | canceled
needs_input -> queued (novo arquivo/texto) | canceled
proposed -> applying | failed | canceled
applying -> applied | proposed (falha de escrita, revisão intacta)
failed  -> queued (retry explícito, preservando checkpoints) | canceled
```

Qualquer outra transição é rejeitada por `UPDATE ... WHERE status = <esperado>` (CAS), nunca por leitura seguida de escrita.

## 3. Checkpoint por etapa

Etapas: `upload` → `extract` → `ingest` → `interpret` → `diff` → `propose` → `apply`.

- Cada etapa grava em `briefing_import_steps` seu `output_ref` (texto extraído no Storage, não em coluna) e `content_hash`.
- Retry parte da primeira etapa não `done`. `extract`/`ingest` concluídos nunca são refeitos; só `interpret` é reexecutado — elimina o custo duplicado de IA de hoje.
- `force` deixa de existir como caminho normal: passa a ser "reprocessar desde a etapa X", com X escolhido explicitamente.

## 4. Concorrência e duplicidade

- Lease: colunas `lease_owner`, `lease_expires_at`, `heartbeat_at`. Aquisição é `UPDATE ... SET lease_* WHERE status='queued' AND (lease_expires_at IS NULL OR lease_expires_at < now()) RETURNING id` — um único vencedor, sem corrida.
- Heartbeat a cada ~15s durante etapas longas; lease de 2 min renovada.
- Índice parcial ativo passa a considerar só estados realmente vivos (`queued`, `leased`, `applying`, `proposed`). `expired`/`failed`/`canceled` não bloqueiam nova importação do mesmo arquivo — fim do travamento atual.
- Idempotência de criação: `idempotency_key` = brand + client + fingerprint do conteúdo + etapa alvo; recriar retorna a run existente em vez de erro.

## 5. Timeout e reaper

- Deadline por etapa (`extract` 60s, `interpret` 120s, `apply` 30s) via `AbortSignal`, propagado às chamadas de LLM e Storage.
- Deadline total da run (ex. 15 min) gravado em `deadline_at`.
- Reaper em `/api/public/cron/import-reaper` (autenticado por `CRON_SECRET`, padrão já do projeto), a cada minuto: leases expiradas voltam a `queued` até `max_attempts`; excedido, `expired` com `error_kind` explícito. Runs além do `deadline_at` vão direto a `expired`.

## 6. Worker e fim da dependência de waitUntil

- `/api/public/cron/import-worker` processa um lote pequeno e limitado (ex. 3 runs) por invocação, com guarda de pausa global.
- O enfileiramento pela UI apenas cria a run `queued`; opcionalmente dispara um "kick" imediato do worker — mas o cron garante o progresso mesmo se o kick falhar.
- Escritas em background usam o cliente de serviço **após** validar escopo brand/cliente na entrada, para não depender do access token do usuário, que pode expirar no meio.

## 7. LLM: tokens, 503 e structured output

- Tabela de capacidades por modelo (contexto, teto de saída, aceita/não aceita `reasoningEffort`, `strictJsonSchema`, tool calling). Sem hardcode de instalação: alimentada pelo catálogo de modelos + overrides do workspace.
- Orçamento de entrada calculado por tokens estimados, não por corte fixo de caracteres. Excedendo, o material é dividido em blocos com merge determinístico; truncamento silencioso deixa de existir e fica registrado no step.
- Cada candidato monta sua própria requisição: Gemini via tool calling; Groq/OpenAI via structured output do adapter, só com parâmetros que aquele provider aceita.
- Schema no wire sem bounds/enums frágeis; limites aplicados na normalização local.
- Classificação de erro: `400`/schema inválido é terminal (sem retry, sem fallback); `429`/`5xx` (503 do Gemini) tem backoff exponencial com jitter, tentativas limitadas e então fallback para o próximo candidato; crédito/limite/config → `paused`, nunca loop.
- Degradação de contrato antes de trocar de provider: estrito → permissivo (JSON livre + validação local).
- Circuit breaker persistido por provider/modelo (reaproveitando `ai_model_health`): provider em falha recente é despriorizado na seleção.

## 8. UI: progresso confiável

- Realtime em `briefing_import_runs` + `briefing_import_steps` como canal primário; polling com backoff (2s→10s) como reserva.
- A UI nunca decide "acabou" por tempo: só por estado terminal ou `expired`/`failed`, sempre com `error_kind` traduzido em pt-BR e ação sugerida (tentar de novo, enviar outro arquivo, avisar o administrador).
- Barra de etapas espelha os steps persistidos, então recarregar a página ou trocar de dispositivo mostra o mesmo progresso.

## 9. Payloads grandes

- Upload direto ao Storage por URL assinada, substituindo Base64 no cliente (hoje ~33MB em memória para 25MB de arquivo).
- Limite de tamanho e de páginas validado antes de criar a run; recusa explícita em vez de falha tardia.
- Extração sempre no servidor (fonte única), eliminando a divergência navegador × servidor.

## 10. Separação do trabalho

**Banco / migrations**
- Novos estados no domínio de `status` (`leased`, `paused`, `needs_input`, `expired`, `canceled`).
- Colunas: `lease_owner`, `lease_expires_at`, `heartbeat_at`, `deadline_at`, `max_attempts`, `resume_step`.
- Steps: `output_ref`, `content_hash`, `deadline_at`.
- Reescrita do índice parcial de run ativa; função de aquisição de lease (`security definer`) e função do reaper.
- Realtime habilitado nas duas tabelas, mantendo as policies de escopo atuais.

**Código**
- Worker e reaper como rotas `/api/public/cron/*` com `CRON_SECRET`.
- Remoção do caminho `waitUntil` como executor; enfileiramento + kick opcional.
- Executor de LLM provider-aware com capacidades, orçamento de tokens, backoff/fallback e classificação de erro.
- Retomada por etapa em `retryImportRun` (sem `force` cego) e checkpoints em `briefing-import.server.ts`.
- Upload por URL assinada e extração unificada no servidor.
- UI: realtime + polling com backoff, estados terminais e mensagens acionáveis.
- Testes: transições inválidas, corrida de lease, reaper, retomada sem recomputar `ingest`, 503→fallback, 400 terminal, schema por provider, arquivo grande, arquivo ilegível.

**Configuração externa**
- Agendamento pg_cron para worker e reaper (por instalação).
- `CRON_SECRET` definido em cada instalação.
- Chaves BYOK dos providers no workspace, com pelo menos dois candidatos para o fallback ter efeito.
- Limites de tamanho de arquivo no bucket do Storage.

## 11. Política de recuperação

- Falha transitória: backoff e reexecução automática do mesmo passo, dentro do limite de tentativas.
- Isolate morto: reaper devolve a `queued` e o worker retoma do último checkpoint.
- Falha terminal de provider: `paused`, visível ao administrador, retomada por ação explícita ou probe único.
- Conteúdo inservível: `needs_input`, com orientação ao usuário.
- Tentativas esgotadas: `expired`, sem bloquear novas importações; histórico e revisão anteriores permanecem íntegros.

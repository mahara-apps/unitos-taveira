# Auditoria READ-ONLY — Execução assíncrona do Onboarding Rápido (import de briefing)

Escopo: criação da run → execução em background → conclusão/erro → polling da UI → retry.
Nenhum código, dado ou migration foi alterado.

## Mapa do fluxo real

1. UI (`briefing-import-dialog.tsx`, reutilizado pelo Quick Onboarding)
   - arquivo → `uploadClientDocument` (Base64) → `POST /api/jobs/analyze-document`
   - texto/transcrição → `POST /api/jobs/analyze-briefing-text`
2. Route handler (`src/routes/api/jobs/analyze-document.ts`, `analyze-briefing-text.ts`)
   - valida Bearer (`token.split(".").length !== 3`), resolve `userId`, `guardClientScope`
   - `buildInputFingerprint` → `startImportRun` (idempotência) → marca documento `ai_status='queued'`
   - `waitUntil(runAnalysis(...))` e responde **202** com `{ runId, reused }`
3. Background (`runAnalysis`)
   - `claimImportRun` (`queued → running` condicional)
   - steps: `ingest` → `interpret` (IA) → `diff` → `propose` (`saveImportProposal` deixa a run em `proposed`)
   - erro → `setRunStep(interpret,'failed')` + `failImportRun` (`status='failed'`)
4. UI acompanha por `getBriefingImportRun` com `refetchInterval: 2500` enquanto `shouldPollRun(status)`
   (`queued | running | applying`), depois revisão campo a campo e `applyBriefingImportRun`.

Estado da máquina (server): `queued → running → proposed → applying → applied`; terminais `failed | cancelled | discarded`.

## Respostas às 10 perguntas

**(1) HTTP termina antes do job.** É o comportamento normal e desejado: o handler responde 202 imediatamente e o processamento continua em `waitUntil`. A UI não depende da resposta HTTP para saber o resultado — só do `runId`. Nenhum dado é perdido, pois todo progresso é gravado em `briefing_import_runs`/`_steps`.

**(2) Se `waitUntil` falha ou é interrompido.** `wait-until.server.ts` só faz `catch` e `console.error`: nada marca a run como falha. Se o isolate for encerrado (deploy, eviction, limite de CPU/tempo do Worker) no meio do `interpret`, a run permanece em `running` (ou `queued`, se o kill ocorreu antes do `claim`) **para sempre**. Em dev/Node o fallback é apenas `void safe` — depende do event loop continuar vivo.

**(3) Risco de run presa em `running`.** Sim, risco real e não mitigado:
- não existe lease com expiração nem `heartbeat_at`;
- não existe reaper/cron que expire runs (`src/routes/api/public/cron/` só tem `sla-check.ts`);
- `retryImportRun` exige `status='failed'`, então uma run presa em `running` **não é retomável nem reprocessável**;
- pior: `briefing_import_runs_active_key_idx` (único parcial em `status IN ('queued','running','proposed','applying')`) faz a run presa **bloquear** novas execuções do mesmo arquivo — só o caminho `force: true` (fingerprint sufixado com `Date.now()`) escapa.

**(4) Como o frontend sabe que terminou.** Exclusivamente por polling do status da run; `proposed` abre a revisão, `failed` mostra erro. Não há sinal push nem callback.

**(5) Polling/realtime confiável?** Polling de 2,5 s é razoável, mas incompleto: não tem timeout de tela, então uma run presa em `running` mantém a UI em "processando" indefinidamente (o watchdog existe em outras telas, não aqui). Não há Realtime nas tabelas de import.

**(6) Retomada a partir do último passo.** Não existe. `retryImportRun` apenas devolve a run para `queued` e **ninguém consome a fila** — nenhum worker faz poll de `queued`. Na prática o botão de reprocessar da UI ignora `retryBriefingImportRun` (não há chamador fora de `briefing-import.functions.ts`) e refaz tudo com `force: true`: novo upload/ingest + nova chamada de IA, mesmo que `ingest` já estivesse `done`. Custo de IA pago novamente.

**(7) Jobs duplicados.** Baixa probabilidade no caminho normal: fingerprint + índice único parcial + `findActiveRun` no erro 23505 + `claimImportRun` condicional. Mas há duas brechas: (a) todo `force: true` cria uma run nova e paralela, sem cancelar a anterior; (b) `claimImportRun(...).catch(() => true)` trata falha de rede/RLS como "claim obtido", permitindo duas execuções simultâneas em cenário de erro transitório.

**(8) Evitar duas execuções simultâneas.** Hoje: o índice único parcial e o `claim` condicional. Falta: lock com expiração (o `claim` é one-shot e não é renovado), cancelamento da run anterior no `force`, e remoção do `catch(() => true)`.

**(9) Timeouts por camada.**
- Frontend: nenhum (`fetch` sem `AbortSignal`, polling sem prazo máximo).
- Route handler: nenhum explícito; limite implícito da plataforma.
- Background: nenhum (`waitUntil` sem deadline).
- IA (`ai-provider.server.ts` / `briefing-ai-executor.server.ts`): nenhum `AbortSignal`/timeout — só troca de provider em 503/429/quota.
- Banco: nenhuma expiração de run/step.
Conclusão: **não existe timeout em nenhuma camada** — apenas o kill silencioso do runtime.

**(10) Propagação de erros para a UI.** Boa quando o `catch` roda: técnico vai para `briefing_import_steps.error` + log; amigável (`friendlyAnalysisError`) para `briefing_import_runs.error`, `client_documents.ai_error` e o modal. Falha quando o processo morre antes do `catch` (item 2) ou quando o próprio `failImportRun` falha (está sob `.catch(() => undefined)`), casos em que a UI nunca recebe erro.

## Riscos adicionais observados

- **Token do usuário como credencial do job**: `runAnalysis` usa o access token recebido no request. Job longo (ou run reprocessada muito depois) pode esbarrar na expiração do token → escritas de step falham silenciosamente.
- **`ai_job_id` nunca é preenchido** pelos dois workers, embora `startImportRun` aceite `aiJobId`: a integração com `ai_jobs` (job visível/observável) está inerte.
- **Base64 no cliente** para arquivos de até 25 MB (~33 MB em memória) antes do upload — ponto de travamento de aba, fora do escopo assíncrono mas no mesmo caminho.

## Arquitetura mínima proposta (não implementada)

1. **Lease com expiração** em `briefing_import_runs`: `locked_by`, `locked_at`, `heartbeat_at`, `lease_expires_at`. `claim` só vence se a lease estiver livre ou expirada; o job renova o heartbeat entre passos. Remover o `catch(() => true)` (falha de claim = não executar).
2. **Reaper agendado** em `src/routes/api/public/cron/import-runs-reap.ts` (gate por `CRON_SECRET`, batch limitado, idempotente): runs `queued`/`running` com lease expirada → `failed` com `error_kind='stalled'` (ou `queued` se `attempt < max`). Isso é o que libera o índice único e devolve a run ao usuário.
3. **Fila realmente consumida**: um único worker (o mesmo endpoint de cron ou um kick pós-`retry`) processa runs `queued`, para que `retryImportRun` deixe de ser um estado morto.
4. **Retomada por passo**: antes de cada passo, checar `briefing_import_steps.status='done'` e reaproveitar `output`/`input_ref` (ingest já feito, texto extraído já persistido) — retry recomeça no `interpret`, sem novo upload nem novo custo de IA.
5. **Deadlines explícitos em cada camada**: `AbortSignal` generoso na chamada de IA (minutos, nunca segundos), orçamento total do job menor que o limite do runtime, e prazo máximo de polling na UI que transforma "processando eterno" em estado de erro com retry.
6. **Idempotência no `force`**: cancelar (`cancelled`) a run ativa do mesmo fingerprint antes de criar a nova, em vez de sufixar o fingerprint e deixar órfãs.
7. **Credencial de job desacoplada do token do usuário**: executar as escritas do background com cliente de serviço, mantendo a autorização checada no handler (`guardClientScope`) como fronteira de segurança.
8. **Sinal de conclusão mais barato que polling** (opcional): Realtime em `briefing_import_runs` filtrado por brand/cliente, mantendo o polling como fallback.

Prioridade: (1)+(2) eliminam o pior sintoma (run presa e importação bloqueada); (4)+(5) eliminam retrabalho e a UI infinita; o resto é robustez.

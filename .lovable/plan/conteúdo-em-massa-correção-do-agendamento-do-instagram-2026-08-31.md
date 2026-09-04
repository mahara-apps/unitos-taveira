# Conteúdo em massa + correção do agendamento do Instagram

## Parte 1 — Seleção e mudança de estágio em massa (Conteúdo)

Hoje a tela de Conteúdo só permite mover uma peça por vez (arrastar no Kanban ou abrir o modal). A tela já tem filtros por período, canal, formato, mídia e SLA — a seleção em massa vai se apoiar neles.

O que será adicionado:

- **Modo seleção** na barra da tela de Conteúdo (botão "Selecionar"). Ao ativar, cada card do Kanban e cada linha da lista ganha checkbox.
- **Atalhos de seleção**: "Todos os visíveis" (respeita os filtros ativos), "Toda a coluna/estágio", e limpar seleção. Como os filtros já cobrem canal (rede social) e formato, selecionar por rede/formato = filtrar + "todos os visíveis". Vou adicionar também **filtro por projeto** na barra de filtros, para permitir "selecionar por projeto".
- **Barra de ação flutuante** com a contagem selecionada e o seletor de estágio de destino (colunas do pipeline atual), com confirmação antes de aplicar.
- **Aplicação em lote**: move todas as peças selecionadas para o estágio escolhido, reaproveitando exatamente a mesma regra do movimento individual (posição no fim da coluna, derivação de `posts.stage`, revisão/publicado quando aplicável). Nada de publicação automática.
- **Resultado item a item**: aplicado / ignorado (ex.: peça já publicada) / erro, com toast resumo e revalidação do board.

Regras preservadas: escopo por workspace/cliente, RBAC/RLS, pipeline do cliente, limite de 200 peças por lote.

## Parte 2 — Por que o Instagram não postou (30/08, 22h28)

Verifiquei os registros reais de publicação. O destino do Facebook publicou às 22h28 (id externo gravado). O destino do Instagram terminou como `failed` com:

```text
Meta: Application request limit reached (code 4)
publish_attempts: 5
```

Ou seja: **não foi erro de conteúdo, mídia, conta ou autorização — foi limite de requisições do app no Meta (rate limit)**. O problema é como o sistema reage a esse erro:

- O worker roda a cada minuto e trata rate limit como falha comum: incrementa a tentativa e reagenda para o minuto seguinte.
- Com 5 tentativas em ~4 minutos, o item queimou todas as tentativas ainda dentro da janela em que a Meta continuava recusando, e virou `failed` definitivo.
- Instagram consome mais chamadas por publicação (criação do contêiner + verificação + publicação), então é o destino que estoura primeiro — exatamente o que aconteceu: Facebook passou, Instagram não.

Correções previstas:

1. **Classificar rate limit como erro adiável**, separado de falha real: em vez de consumir tentativa imediatamente, o destino volta para `scheduled` com **espera progressiva** (ex.: 2, 5, 15, 30, 60 min).
2. **Não esgotar tentativas por rate limit**: o contador de falhas passa a contar apenas erros que não são de limite; limite tem um teto próprio de reagendamentos e uma janela máxima (ex.: 6 horas) antes de virar falha visível com mensagem clara em português.
3. **Espaçar as chamadas do worker por conexão** dentro de uma mesma execução, para não disparar Instagram e Facebook da mesma conta em rajada.
4. **Mensagem acionável na UI**: "Limite temporário da Meta — nova tentativa automática às HH:MM", em vez de "falha" seca.
5. **Recuperar o item atual**: como o post de 30/08 já está `failed`, ele será reenfileirado pelo botão de reenvio por destino que já existe no modal da publicação (nenhuma publicação automática sem sua ação).

## Detalhes técnicos

- Migration: coluna `next_attempt_at timestamptz` em `social_posts` (+ índice), `rate_limited_until`/contador separado; `claim_scheduled_social_posts` passa a exigir `next_attempt_at is null or next_attempt_at <= now()`; nova RPC `mark_social_post_deferred(p_post_id, p_error, p_retry_at)` que **não** incrementa `publish_attempts`. GRANTs mantidos no padrão atual (execute apenas para os papéis já usados).
- `src/lib/meta/publishing.server.ts`: classificador de erro transitório de limite (códigos 4, 17, 32, 613 e subcódigos de throttling) exposto para o worker.
- `src/routes/api/public/meta/publish-scheduled.ts`: no `catch`, erro de limite → `mark_social_post_deferred` com backoff; demais erros seguem o fluxo atual; pequeno espaçamento entre destinos da mesma conexão.
- Conteúdo: `bulkMoveStageFn` em `src/lib/content.functions.ts` (autenticada, valida pipeline/estágio, máx. 200 ids, resultado por item); seleção em `src/components/content/content-board.tsx` e `content-list.tsx`; filtro de projeto em `content-filters`; barra de ação em novo `src/components/content/bulk-stage-bar.tsx`.
- Validação: `tsgo --noEmit`, testes novos (backoff de limite não consome tentativa; lote ignora peça publicada e respeita escopo), suíte relacionada e build.

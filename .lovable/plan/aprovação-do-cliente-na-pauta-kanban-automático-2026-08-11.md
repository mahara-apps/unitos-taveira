# Aprovação do cliente na Pauta → Kanban automático

## O que muda

O cliente recebe a pauta completa (todos os itens aprovados internamente) e pode:

- **Aprovar tudo** — aprova a pauta inteira de uma vez.
- **Rejeitar** — recusa a pauta inteira (com motivo).
- **Solicitar ajustes** — comentário geral do que deve mudar.
- **Decidir item por item** — em cada tema: aprovar, rejeitar ou comentar ajuste; ao final ele confirma o envio da decisão.

Ao **aprovar** (tudo ou parcialmente), o sistema cria automaticamente os cards no Kanban de Produção de Conteúdo com os itens aprovados pelo cliente, e a pauta passa a "Em produção". Nenhum clique extra da equipe.

## Como a equipe vê o resultado

Na tela da pauta:

- Badge de status no topo com os novos estados: **No cliente**, **Cliente aprovou**, **Ajustes pedidos**, **Cliente rejeitou**, **Em produção**.
- Faixa informativa com data da decisão e o comentário do cliente.
- Em cada card de tema, um badge de decisão do cliente: *Aprovado pelo cliente* / *Rejeitado pelo cliente* / *Ajuste pedido* com o comentário do item.
- Contadores no cabeçalho ("X aprovados pelo cliente · Y com ajuste").
- Quando o cliente rejeita ou pede ajustes, a pauta destrava para edição e pode ser reenviada (novo link continua valendo).

## Detalhes técnicos

**Migração**
- `monthly_plans.status`: passa a aceitar `client_rejected` (coluna é texto; sem enum a alterar). Novas colunas: `client_decision_mode` (text: `bulk` | `per_item`).
- `monthly_plan_topics`: novas colunas `client_status` (text, default `pending`: `pending|approved|rejected|changes`), `client_comment` (text), `client_decision_at` (timestamptz).

**Server (`src/lib/monthly-plan-public.functions.ts`)**
- `resolveMonthlyPlanPublic`: retorna todos os itens com `status = 'approved'` (curadoria interna) incluindo `target_audience`, `rationale`, `client_status`, `client_comment`, e o status/decisão do plano.
- `decideMonthlyPlanPublic`: aceita `decision: 'approve' | 'reject' | 'changes' | 'per_item'`; no modo `per_item` recebe `items[{ topicId, decision, comment }]` validados como pertencentes ao plano do token. Grava decisões nos tópicos, define status do plano (`client_approved`, `client_rejected`, `changes_requested`), `client_decision_at`, `client_feedback` e `client_decision_mode`. Exige comentário em `reject` e `changes`.
- Quando o resultado tem ao menos um item aprovado pelo cliente, chama internamente um helper compartilhado de materialização no Kanban (extraído de `approveMonthlyPlanFn` para `src/lib/monthly-plan-kanban.server.ts`, recebendo o client admin), criando os posts e marcando o plano como `approved`. Idempotente: não recria cards para tópicos que já têm post (`monthly_plan_topic_id`).
- `approveMonthlyPlanFn` passa a usar o mesmo helper (botão manual mantido como reprocesso/fallback) e considera `client_status` na seleção dos tópicos.

**UI pública (`src/routes/pauta.$planId.tsx`)**
- Barra de ações com "Aprovar pauta", "Solicitar ajustes", "Rejeitar" e alternador "Revisar item por item"; no modo por item, cada tema ganha os três botões + campo de comentário e um botão final "Enviar decisão".
- Estado pós-decisão mostra o resumo (aprovados / ajustes / rejeitados) e bloqueia novo envio.

**UI interna (`src/routes/_authenticated/customers.$customerId.pauta.tsx`)**
- `PLAN_STATUS_META` + `StatusBanner`: incluir `client_rejected` e exibir data/feedback da decisão.
- `TopicCard`: badge de decisão do cliente e comentário; `locked` apenas em `pending_client` e `approved`.
- Cabeçalho com contadores de decisão do cliente; toast/atualização via invalidate já existente.

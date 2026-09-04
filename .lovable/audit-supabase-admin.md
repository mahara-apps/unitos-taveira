# Inventário de `supabaseAdmin` (service role) — Fase 1 RBAC

Levantamento read-only dos 35 arquivos que carregam
`@/integrations/supabase/client.server`. **Nada foi removido nesta fase**;
apenas classificado. Regra: o service role bypassa RLS, então todo uso em
caminho autenticado precisa de autorização explícita ANTES do bypass.

## A. Bypass técnico legítimo (sem sessão de usuário)

Rotas públicas/máquina que já autenticam por outro fator (assinatura Meta,
`CRON_SECRET`, token opaco de portal/aprovação) ou tarefas de infraestrutura:

- `src/routes/api/public/meta/callback.ts`, `webhook.ts`, `deauthorize.ts`,
  `data-deletion.ts`, `deletion-status.ts`, `publish-scheduled.ts`
- `src/routes/api/public/cron/sla-check.ts`, `src/routes/api/public/media/prune.ts`
- `src/lib/monthly-plan-public.functions.ts` (sessão por token de pauta)
- `src/lib/portal-scope.server.ts`, `src/lib/portal-media.server.ts`
  (escopo derivado do token do Portal)
- `src/lib/login-branding.functions.ts` (branding pré-login)
- `src/lib/ai-model-health.server.ts`, `src/lib/ai-models-catalog.server.ts`,
  `src/lib/ai-provider.server.ts`, `src/lib/ai-usage.server.ts`,
  `src/lib/agent-prompts.server.ts`
- `src/lib/monthly-plan-observability.server.ts`,
  `src/lib/brain/reasoning/logger.server.ts`,
  `src/lib/brain/social-metrics-sync.server.ts`,
  `src/lib/brain/ingest-quiet.server.ts`,
  `src/lib/brain/legacy/brain-embed.server.ts`,
  `src/lib/brain/learning/synthesize.server.ts`
  (workers/telemetria sem ator humano)

## B. Precisa autorização antes do bypass (verificado nesta fase)

- `src/lib/team.functions.ts` — usa `assertBrandAdmin` /
  `assertCanGrantBrandRole` antes de escrever `brand_members`. **OK.**
- `src/lib/team-admin.functions.ts` — valida `assertClientOfBrand` +
  autoridade de workspace. **OK.**
- `src/lib/portal-accounts.functions.ts` — carrega o cliente por
  `context.supabase` (RLS) antes do bypass. **OK.**
- `src/lib/briefing-tokens.functions.ts` — escopo do cliente validado antes de
  emitir token. **OK.**
- `src/lib/channels-center.functions.ts` — **corrigido nesta fase**: passou a
  chamar `assertClientScope` antes de gravar auditoria com `clientId` recebido
  do frontend.
- `src/lib/brain/legacy/brain-consolidate.functions.ts`,
  `src/lib/brain/chat-gateway/tools.server.ts` — exigem workspace + escopo do
  cliente pelas RPCs canônicas.
- `src/lib/agents.functions.ts`, `src/lib/post-agents.server.ts`,
  `src/routes/api/jobs/customer-pipeline.ts` — leitura de contexto por
  `context.supabase`; escrita de job com `client_id` já validado.

## C. Potencialmente inseguro (revisar na próxima fase)

- `src/routes/api/jobs/*` (copilot, analyze-document): autenticam a sessão,
  mas parte do payload (`clientId`, `postId`) só é validada indiretamente —
  candidato a `assertClientScope`/`assertProjectScope` explícito.
- Workers do Cérebro que agregam por `brand_id` sem recorte de cliente:
  aceitável para consolidação interna, mas qualquer resultado exposto na UI
  deve passar pelas policies (`brain_*` já reescritas na Fase 1).

## Diretriz permanente

Nenhuma server function pode confiar em `brandId`/`clientId`/`projectId`/
`taskId` vindos do frontend antes de `assertBrandAdmin`, `assertClientScope`,
`assertProjectScope` ou `assertTaskScope` (`src/lib/access-guard.ts`).

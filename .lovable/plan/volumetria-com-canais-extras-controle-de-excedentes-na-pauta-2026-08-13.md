# Volumetria com canais extras + controle de excedentes na Pauta

## O que muda para o usuário

1. **Briefing → Volumetria**: além dos 5 canais atuais (Instagram, TikTok, LinkedIn, YouTube, Facebook), um botão **"+ Adicionar canal"** permite incluir **X (Twitter)** e **Threads**. Canais adicionados aparecem na mesma lista, com quantidade semanal e formatos, e podem ser removidos.
2. **Pauta respeita a volumetria**: hoje o wizard só avisa quando a quantidade passa da cota do mês — a geração acontece de qualquer forma. Passa a **bloquear**: se a soma (já gerado no mês + novo pedido) exceder a cota do briefing em algum canal, a geração não roda e o wizard mostra o excedente por canal com um botão **"Solicitar liberação"**.
3. **Solicitação de excedente**: cria um registro com cliente, canal, cota, quantidade pedida, excedente, quem pediu, data e justificativa. Enquanto estiver pendente, o wizard mostra o aviso de "aguardando liberação do gestor de conta".
4. **Autorização**: apenas **owner** e **manager** podem aprovar ou recusar. Após aprovação, a cota extra fica disponível para aquele canal/mês e a geração passa.
5. **Tela de excedentes** (nova, em Configurações → Operação → **Excedentes**): lista global de todos os clientes com data da solicitação, cliente, canal, cota, excedente, solicitante, status (pendente / autorizado / recusado), quem autorizou e quando. Filtros por status e por cliente. Ações de aprovar/recusar direto na lista para owner/manager.

## Detalhes técnicos

**Canais**
- `PLAN_CHANNELS` (`src/lib/monthly-plan-fields.ts`) passa a incluir `x` e `threads`, com labels; `PLAN_CHANNEL_LABEL` atualizado. `FORMATS_BY_CHANNEL` já cobre ambos (`feed`).
- `briefing-workspace.tsx`: `SocialKey` e `SOCIALS` viram catálogo derivado de `PLAN_CHANNELS`; a lista renderiza apenas os canais "ativos" (com valor salvo em `brand_hub.volumetry` ou adicionados na sessão) e o botão "+" abre um menu com os canais restantes. Persistência continua em `brand_hub.volumetry` / `brand_hub.formats` (jsonb) — sem migração para isso.
- `monthly-plan-context.server.ts`, `volumetry-cards.tsx` e `generate-plan-wizard.tsx` já iteram `PLAN_CHANNELS`, então herdam os novos canais.
- `monthly_plan_topics.channel` é `text` — nenhuma alteração de enum necessária.

**Excedentes (migração)**
- Nova tabela `public.plan_overage_requests`: `brand_id`, `client_id`, `channel text`, `period_month date` (1º dia do mês), `quota int`, `requested int`, `overage int`, `justification text`, `status text` default `pending` (`pending|approved|rejected`), `requested_by uuid`, `decided_by uuid`, `decided_at timestamptz`, `created_at`, `updated_at` + trigger de `updated_at`.
- GRANTs para `authenticated` e `service_role`; RLS: membros da marca leem (`is_brand_member`), membros criam solicitação, e apenas `has_brand_role(brand_id, auth.uid(), 'owner'|'manager')` pode atualizar status. Índice por `(client_id, channel, period_month, status)`.

**Servidor**
- `src/lib/plan-overage.functions.ts`: `listOverageRequestsFn` (filtros status/cliente), `requestOverageFn`, `decideOverageFn` (checa papel owner/manager no servidor).
- `generateMonthlyPlanFn` (`src/lib/monthly-plans.functions.ts`): antes de chamar a IA, recalcula `generatedThisMonth` por canal e compara com `monthlyQuota + aprovado no mês`. Excedendo, retorna `{ ok: false, code: "overage_not_authorized", details: [{ channel, quota, requested, overage }] }` — sem lançar exceção, seguindo o padrão atual de union de status.
- `getPlanVolumetryFn` passa a devolver `approvedOverage` por canal para os cards e o wizard mostrarem a cota efetiva.

**UI**
- `generate-plan-wizard.tsx`: bloqueia "Gerar" quando há excedente sem autorização; exibe painel de excedente com justificativa e ação "Solicitar liberação"; estado "aguardando liberação" quando já existe pendência.
- `src/routes/_authenticated/settings.overages.tsx` + item no menu de Configurações: tabela global com filtros e ações de aprovar/recusar (visíveis só para owner/manager).
- `errors.ts`: mensagem em português para `overage_not_authorized`.

## Fora do escopo
Portal do cliente, calendário, kanban e publicação automática não mudam.

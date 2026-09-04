# Liberação de excedente: hierarquia, notificação e volumetria livre

## O que está acontecendo (verificado no código)

1. **Solicitação não notifica ninguém.** `requestPlanOverageFn` (`src/lib/plan-overage.functions.ts`) apenas insere linhas em `plan_overage_requests` com `status: pending`. Não há inserção em `notifications` — por isso nada aparece no sino nem em `/notifications`.
2. **A aprovação existe, mas está escondida.** A antiga rota `/settings/overages` só redireciona para `/customers`. A lista real é o painel `ProductionOverages`, dentro do perfil do cliente → aba **Produção**, e os botões Autorizar/Recusar só aparecem para `role === "admin"`.
3. **O bloqueio é absoluto.** Em `monthly-plan-generate.server.ts`, se `requested > cota + excedente aprovado`, retorna `overage_not_authorized` e a geração para — para qualquer papel, sem exceção.

## Rota de correção

### A. Hierarquia: quem não precisa pedir liberação

Fonte canônica de papel: `resolveAuthorityRole` / `brand_member_role` (`src/lib/access-guard.ts`).

- **Super Admin, Owner, Admin** → geram acima da volumetria **sem** solicitar. O excedente é registrado automaticamente como autorizado (autoria = o próprio usuário), então o histórico e os relatórios de Produção continuam corretos.
- **Manager e User** → seguem solicitando liberação ao gestor.
- No wizard, para papéis com autoridade, o card amarelo deixa de bloquear: passa a ser um aviso "Acima da volumetria — será registrado como excedente autorizado", e o botão "Gerar N peças" fica habilitado.

### B. Onde a aprovação aparece (e passa a notificar)

- Ao solicitar, criar notificação `approval_requested` para os aprovadores (Owner/Admin do workspace + Super Admin + responsáveis internos do cliente), com canal, cota, pedido, excedente e justificativa, link direto para o cliente → aba Produção. Dedupe por solicitação, mesmo mecanismo já usado na decisão de pauta.
- Ao decidir, notificar de volta o solicitante (autorizado/recusado).
- Manter a lista em Cliente → Produção como tela oficial de aprovação, com contador de pendências visível na aba.

### C. Volumetria livre (não bloquear)

Novo modo de aplicação da volumetria, em dois níveis (workspace como padrão, cliente como override):

- **Bloquear** (atual): acima da cota exige liberação.
- **Avisar** (livre): a cota vira referência; gera normalmente e registra o excedente como autorizado, aparecendo em Produção como excedente do mês.

Onde configurar:
- Workspace: Configurações → padrão da conta.
- Cliente: perfil do cliente → Produção, opção "Volumetria livre (não bloquear)" — só Owner/Admin/Super Admin alteram.

Quando o modo é "Avisar", ninguém é bloqueado (inclusive Manager/User), mas o excedente continua registrado e visível.

## Detalhes técnicos

- Migration: coluna `overage_policy` (`block` | `warn`) em `brands` (padrão `block`) e coluna nullable em `clients` para override; grants/RLS existentes já cobrem essas tabelas — nenhuma tabela nova, nenhuma alteração de RLS/RBAC/auth/tenants.
- `plan-overage.server.ts`: `resolveOveragePolicy(brandId, clientId)` e `autoAuthorizeOverage()` que insere linhas com `status: approved`, `decided_by` = usuário, marcando a origem (bypass hierárquico ou política livre).
- `monthly-plan-generate.server.ts`: antes de devolver `overage_not_authorized`, consultar papel + política; se houver bypass, autorizar e prosseguir.
- `plan-overage.functions.ts`: notificações em `requestPlanOverageFn` e `decidePlanOverageFn` via `insertNotificationsDeduped`; `decidePlanOverageFn` passa a validar autoridade explicitamente (`assertBrandAdmin` sem manager) em vez de depender só da RLS.
- UI: `generate-plan-wizard.tsx` (aviso vs bloqueio, conforme papel/política), `production-overages.tsx` (toggle de volumetria livre + pendências), aba Produção com contador.
- Testes: bypass por papel, política `warn` por cliente e por workspace, Manager/User ainda bloqueados em `block`, criação/dedupe de notificações, decisão negada para papel insuficiente. Ao final: typecheck, suíte e build.

Sem alterar RBAC/RLS existentes, autenticação, tenants/workspaces, arquitetura de Instalação × Workspace ou migrations históricas.

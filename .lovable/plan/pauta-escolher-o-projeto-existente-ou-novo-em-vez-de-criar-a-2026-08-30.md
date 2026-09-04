# Pauta: escolher o projeto (existente ou novo) em vez de criar automático

## Situação atual

- A criação manual de pauta (`new-pauta-dialog`) já pergunta o projeto: Nenhum / Existente / Novo.
- A pauta gerada por IA **não** pergunta nada: o plano nasce sem projeto e, na aprovação interna (gerar link do cliente), o sistema cria sozinho um projeto chamado "Pauta — <título>". A tela da pauta ainda tem uma "auto-cura" que cria o projeto sem pedir confirmação.

## O que muda

A escolha do projeto passa a ser obrigatória e explícita em toda criação de pauta — nunca mais criação automática.

**No wizard de geração por IA**, no passo "Escopo", entra o mesmo seletor já usado na criação manual, com duas opções:

- **Projeto existente** — lista dos projetos ativos daquele cliente, com busca.
- **Novo projeto** — o usuário nomeia o projeto (e opcionalmente descrição e prazo).

Sem uma das duas definidas, o botão de avançar/gerar fica desabilitado com a indicação do que falta. A opção "Nenhum projeto" sai do fluxo de criação (segue disponível apenas para reorganizar uma pauta já existente).

**Na criação manual**, o seletor deixa de aceitar "Nenhum projeto" e passa a exigir existente ou novo, para o comportamento ser idêntico nos dois caminhos.

**Na aprovação interna**, o sistema não cria mais projeto por conta própria. Se uma pauta antiga chegar lá sem projeto, aparece um diálogo pedindo para vincular a um existente ou nomear um novo — e só depois o link do cliente é gerado. O botão "Criar projeto" na tela da pauta passa a abrir esse mesmo diálogo de escolha em vez de criar direto.

Pautas antigas já vinculadas continuam como estão; nada é renomeado nem re-vinculado.

## Detalhes técnicos

- `src/lib/monthly-plans.functions.ts`
  - `GenerateInput` recebe `organization: PlanOrganization` (aceita apenas `existing` | `new` na criação) e `runPlanGeneration` grava o `project_id` resolvido por `resolveProjectForPlan`, espelhando `projects.monthly_plan_id` como já faz `createMonthlyPlanFn`.
  - `createMonthlyPlanFn`: rejeita `mode: "none"` (novo erro `project_required`).
  - `createPlanClientLinkFn`: remove a chamada a `ensurePlanProject`; se `plan.project_id` for nulo, lança `project_required` antes de mudar status/emitir token (nada é gravado pela metade).
  - `ensurePlanProjectFn` deixa de criar projeto implicitamente; a criação passa a usar `setPlanProjectFn`, que já existe e é explícito. `src/lib/monthly-plan-project.server.ts` fica apenas para reconciliar o vínculo (sem insert).
  - `monthly-plan-kanban.server.ts`: quando não houver projeto, falha com `project_required` em vez de criar um.
- `src/lib/monthly-plan-generate.server.ts`: passa `project_id` no insert do plano (vindo do resolvedor acima) e mantém o caminho de retomada intacto.
- `src/components/monthly-plan/pauta-organization-field.tsx`: aceita prop `allowNone` (default `true`); `toOrganizationInput` retorna `null` para `none` quando `allowNone` é `false`.
- `src/components/monthly-plan/generate-plan-wizard.tsx`: novo bloco de organização no passo "Escopo", `brandId`/`clientId` recebidos por prop, validação bloqueando avanço, e `onGenerate` passando `organization`.
- `src/components/monthly-plan/monthly-plan-view.tsx`: remove o efeito de auto-cura; "Criar projeto" abre o diálogo de vínculo (`setPlanProjectFn`); ao aprovar internamente sem projeto, abre o mesmo diálogo e explica o motivo.
- `src/components/monthly-plan/new-pauta-dialog.tsx`: usa `allowNone={false}` na criação (o painel de reorganização mantém "Nenhum projeto").
- Mensagens de erro traduzidas: `project_required`, `project_not_in_scope`.
- Testes novos em `tests/` cobrindo: geração com `existing` fora de escopo (rejeita), geração com `new` (cria e espelha vínculo), criação manual sem projeto (rejeita) e aprovação interna sem projeto (rejeita sem alterar status).
- Sem mudanças de banco, migrations, RBAC/RLS, auth ou tenants/workspaces.

## Validação

Typecheck, suíte de testes e build; conferência do wizard de IA e da criação manual no preview.

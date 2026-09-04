# Pauta: botão Voltar e ID da pauta na URL

## Problemas confirmados

1. **Voltar sai da Pauta.** Na barra fixa, o botão chama `navigate({ to: ".." })`. Como a tela aberta é `/monthly-plan` (rota única, sem rota-pai de conteúdo), o `..` joga o usuário fora da Pauta em vez de voltar para a lista/geração de pauta.
2. **O ID da pauta não aparece no endereço.** Hoje a pauta aberta é guardada apenas como parâmetro de busca (`?planId=...`) e a barra de endereço do preview mostra só `/monthly-plan`. Não existe rota com o ID no caminho, então o link não é compartilhável nem identificável.

## O que será feito

### 1. Voltar volta para a Pauta
O botão Voltar passa a limpar a pauta aberta e retornar para a tela inicial da Pauta (cards de volumetria + wizard de geração + histórico), no mesmo cliente ativo — sem sair do módulo.

### 2. ID da pauta no caminho da URL
A pauta aberta passa a ter endereço próprio:

```text
/monthly-plan                -> tela inicial (volumetria, gerar, histórico)
/monthly-plan/<id-da-pauta>  -> pauta aberta para revisão/aprovação
```

- Abrir uma pauta do histórico, gerar uma nova ou concluir a geração navega para `/monthly-plan/<id>`.
- Voltar navega para `/monthly-plan`.
- Links antigos com `?planId=...` continuam funcionando: são redirecionados para o novo endereço.

A mesma tela usada dentro do cliente (`/customers/<cliente>/pauta`) continua funcionando como hoje, sem quebra.

## Detalhes técnicos

- `src/routes/_authenticated/monthly-plan.tsx` passa a ser rota de layout (valida contexto do cliente, define o cabeçalho e renderiza `<Outlet />`).
- Novos arquivos:
  - `monthly-plan.index.tsx` → renderiza `MonthlyPlanView` sem pauta selecionada; se receber `?planId=` legado, redireciona para `/monthly-plan/$planId`.
  - `monthly-plan.$planId.tsx` → renderiza `MonthlyPlanView` com o `planId` do caminho.
- `MonthlyPlanView` (em `customers.$customerId.pauta.tsx`) ganha props opcionais `planId` e `onSelectPlan`, com fallback para o comportamento atual baseado em `useSearch` quando montada pela rota do cliente. `setPlanId` passa a delegar para `onSelectPlan` quando fornecido.
- Barra fixa: `Voltar` troca `navigate({ to: ".." })` por `setPlanId(null)`, o que resulta em `/monthly-plan` (ou remoção do `?planId=` na rota do cliente).
- Sem alterações de schema, server functions ou lógica de geração/aprovação.

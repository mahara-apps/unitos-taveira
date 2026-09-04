# Refatoração da tela de Pauta + Wizard de geração

## Objetivo

Hoje a tela de Pauta (quando não há pauta selecionada) é um único bloco vertical com a volumetria listada em texto, tema e briefing. Vamos quebrar em cards separados de leitura rápida e mover a geração para um modal com wizard, onde o usuário escolhe canais, formatos e quantidade.

## 1. Painel de volumetria (cards separados)

Substituir a lista de texto por cards:

- **Card por canal** (só canais com meta > 0): meta semanal, cota mensal, quanto já foi gerado no mês, quanto resta disponível, com barra de progresso.
- **Card "Total do cliente"**: soma das cotas mensais, total gerado no mês, total disponível.
- Estado vazio mantém o aviso atual (volumetria não definida → link para Briefing → Metas de publicação).

```text
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│ Instagram    │ │ TikTok       │ │ LinkedIn     │ │ TOTAL CLIENTE  │
│ 13 / mês     │ │ 9 / mês      │ │ 4 / mês      │ │ 26 / mês       │
│ 8 gerados    │ │ 9 gerados    │ │ 0 gerados    │ │ 17 gerados     │
│ 5 disponíveis│ │ 0 disponíveis│ │ 4 disponíveis│ │ 9 disponíveis  │
│ ▓▓▓▓▓▓░░░░   │ │ ▓▓▓▓▓▓▓▓▓▓   │ │ ░░░░░░░░░░   │ │ ▓▓▓▓▓▓░░░░     │
└──────────────┘ └──────────────┘ └──────────────┘ └────────────────┘
```

"Gerado no mês" = itens de pauta do cliente criados no mês corrente, contados por canal (somando todas as pautas do mês, não só a atual).

## 2. Wizard de geração (modal)

Botão "Gerar pauta" abre modal com 3 passos:

1. **Escopo** — tema do mês (opcional) e briefing vinculado (opcional), como hoje.
2. **Canais e volume** — checkbox por canal com meta definida; para cada canal ativo, um stepper de quantidade pré-preenchido com o disponível do mês (limite = cota mensal restante, com aviso quando o usuário estourar a meta). Total consolidado no rodapé.
3. **Formatos** — por canal selecionado, multiselect de formatos permitidos (pré-marcados com os formatos do briefing, se houver; senão todos). Resumo final + botão "Gerar".

O modal mantém o skeleton/mensagens de progresso atuais durante a geração. Cancelar fecha sem perder os cards da tela.

## 3. Ajustes de lógica (mínimos, para o wizard funcionar)

- `getPlanVolumetryFn` passa a devolver também `generatedThisMonth` por canal e total.
- `generateMonthlyPlanFn` aceita uma seleção opcional: `channels: [{ channel, quantity, formats[] }]`. Sem seleção, comportamento atual (cota cheia do briefing). Com seleção, o prompt e a distribuição/normalização usam essas quantidades e limitam os formatos por canal.
- Nada muda no schema do banco, no fluxo de aprovação interna/cliente, nem na tela da pauta já gerada.

## Arquivos afetados

- `src/routes/_authenticated/customers.$customerId.pauta.tsx` — troca do bloco de geração pelos cards + botão que abre o wizard.
- `src/components/monthly-plan/volumetry-cards.tsx` (novo) — cards de canal e total.
- `src/components/monthly-plan/generate-plan-wizard.tsx` (novo) — modal de 3 passos.
- `src/lib/monthly-plans.functions.ts` — input opcional de seleção + contagem do mês.
- `src/lib/monthly-plan-context.server.ts` — expõe formatos por canal do briefing para pré-marcar o passo 3.

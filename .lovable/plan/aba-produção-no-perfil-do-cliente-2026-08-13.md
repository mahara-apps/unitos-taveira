# Aba "Produção" no perfil do cliente

Tirar a tela global de Excedentes de Configurações e trazer o controle para dentro do perfil do cliente, numa aba nova chamada **Produção**, que reúne o relatório do que foi produzido e as solicitações extras/excedentes.

## O que a aba mostra

**Topo — resumo do período**
Quatro indicadores do mês selecionado: peças previstas (volumetria do briefing), peças geradas na pauta, peças publicadas e excedentes autorizados.

**Bloco 1 — Relatório de produção (com filtros)**
Lista do que foi produzido, com filtros de:
- Período (mês atual, mês anterior, últimos 3 meses, intervalo livre)
- Canal / rede social (catálogo já existente, incluindo canais extras da volumetria)
- Etapa/status (ideia, produção, revisão, aprovado, agendado, publicado)

Cada linha traz título, canal, formato, etapa atual, data (agendada/publicada) e origem (pauta ou criado direto). Rodapé com contagem por canal versus a volumetria contratada, para leitura rápida de "dentro/acima do combinado".

**Bloco 2 — Solicitações extras e excedentes**
A mesma listagem que hoje existe em Configurações → Excedentes, filtrada por este cliente: canal, quantidade pedida, cota disponível, excedente, justificativa, autor, data e status (aguardando liberação / autorizado / recusado). Quem tem permissão de gestor autoriza ou recusa direto daqui, com abas de status (Pendentes / Autorizados / Recusados / Todos).

## Navegação

- Nova aba **Produção** na barra de abas do cliente, entre "Pauta" e "Canais", com `?tab=producao` compartilhável.
- A rota global **Configurações → Excedentes** sai do menu; o acesso passa a ser pelo cliente. Para não perder links antigos, o caminho antigo redireciona para a lista de clientes com aviso de onde encontrar.
- Alertas de excedente pendente já existentes na pauta passam a apontar para esta aba.

## Detalhes técnicos

- Nova aba em `src/routes/_authenticated/customers.$customerId.tsx`: entrada `producao` no enum de `validateSearch`, em `CustomerTab` e em `ALL_TABS`, mais o `TabsContent` correspondente.
- Novos componentes em `src/components/customer/production/`:
  - `production-tab.tsx` (orquestrador: resumo + filtros + dois blocos)
  - `production-report.tsx` (tabela filtrável do que foi produzido)
  - `production-overages.tsx` (extraído da tela atual `settings.overages.tsx`, agora com `clientId` fixo)
- Dados: reaproveita `listPlanOverageRequestsFn` (já aceita `clientId`) e `decidePlanOverageFn` de `src/lib/plan-overage.functions.ts`, além de `getPlanVolumetryFn`. Para o relatório, uma nova server function `listProductionReportFn` em `src/lib/production-report.functions.ts` sob `requireSupabaseAuth`, lendo `posts` e `monthly_plan_topics` por marca/cliente com filtros de período, canal e etapa (sem mudança de schema).
- Autorizar/recusar continua checando papel via o mesmo caminho já usado hoje; usuários sem permissão veem a lista em modo leitura.
- `src/routes/_authenticated/settings.overages.tsx` passa a redirecionar e a entrada "Excedentes" sai de `settings.tsx`.

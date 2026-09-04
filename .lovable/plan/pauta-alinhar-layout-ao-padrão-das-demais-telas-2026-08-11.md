# Pauta: alinhar layout ao padrão das demais telas

Ajuste apenas visual/estrutural na tela de Pauta mensal (estado de volumetria/geração e estado de aprovação). Nenhuma mudança de lógica, dados ou geração de IA.

## O que muda

1. **Remover o badge "Pauta mensal"** do topo — o título "Volumetria e geração do mês" fica como cabeçalho direto, com o botão "Gerar pauta com IA" à direita.
2. **Usar o mesmo contêiner das outras páginas**: trocar o `max-w-5xl` centralizado com padding extra pelo shell padrão do dashboard (largura total, padding responsivo), igual a Análises, Clientes, Projetos e Calendário. Isso elimina o excesso de espaço lateral e distribui os cards na tela.
3. **Cards de volumetria em grade mais larga**: aproveitando a largura total, a grade passa a acomodar mais cards por linha em telas grandes (até 5-6 colunas), evitando a segunda linha quase vazia da referência.
4. **Card "Total do cliente" primeiro**: passa a ser o primeiro item da grade, antes dos canais, mantendo o destaque visual atual.
5. **Estado de aprovação** (quando uma pauta está aberta) e a barra fixa inferior também passam para o mesmo padrão de largura/padding, para a navegação entre os dois estados não "pular".

## Detalhes técnicos

- `src/routes/_authenticated/customers.$customerId.pauta.tsx`: substituir `mx-auto max-w-5xl ... px-6 py-8` (estado de geração) e `mx-auto max-w-4xl ... px-6 py-8/py-10` (aprovação, loading) por `DashboardPageShell` de `@/components/ui/dashboard-primitives`; remover o bloco do pill com `Sparkles` + "Pauta mensal"; alinhar o contêiner da barra fixa (`max-w-4xl`) ao mesmo padding do shell.
- `src/components/monthly-plan/volumetry-cards.tsx`: mover o `MetricCard` de "Total do cliente" para antes do `channels.map`, e ampliar a grade (`sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`), aplicando o mesmo ajuste ao skeleton.
- Sem alterações em `monthly-plans.functions.ts`, no wizard ou em qualquer query.

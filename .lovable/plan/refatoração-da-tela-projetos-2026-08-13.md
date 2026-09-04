# Refatoração da tela Projetos

Mudanças apenas de interface na tela `/projects` (área de conteúdo + cabeçalho). Nenhuma alteração de regra de negócio ou de dados.

## O que muda

1. **Remover o bloco do Brain**
   - Sai o painel "Brain · Risco de atraso" da tela.

2. **Remover o botão "Relatório"**
   - Cabeçalho fica com apenas "Novo projeto" (em branco / a partir de modelo).

3. **Projetos/pautas em lista com ordenação**
   - Substituir o grid de cards por uma tabela/lista densa com colunas:
     Projeto (cor + nome), Cliente, Status, Pauta (badge de status), Período (início — fim), Progresso (publicadas/total + barra), Publicadas.
   - Cabeçalhos de coluna clicáveis para ordenar (asc/desc) por: Projeto, Cliente, Status, Período (data de entrega), Progresso.
   - Ordenação padrão: entrega mais próxima primeiro.
   - Linha inteira clicável, levando ao projeto (mesmo destino atual).
   - Estado vazio e skeleton de carregamento adaptados ao formato lista.

4. **Filtros melhorados**
   - Uma barra de filtros única e mais compacta: busca, Status, Responsável, Cliente.
   - Busca passa a considerar nome do projeto **e** nome do cliente.
   - Chips dos filtros ativos abaixo da barra, cada um removível, mais "Limpar filtros".
   - Contador de resultados ("N projetos").

5. **Reforma do filtro de conta (cliente)**
   - Hoje o seletor fica travado e desabilitado quando há cliente ativo na sidebar, o que parece um campo quebrado.
   - Novo comportamento: o seletor fica sempre habilitado, com busca por nome, avatar/cor do cliente e opção "Todos os clientes".
   - Quando há cliente ativo na sidebar, ele entra como valor inicial e recebe a marca "da sidebar", mas o usuário pode trocar livremente nesta tela.

## Detalhes técnicos

- Arquivo principal: `src/routes/_authenticated/projects.index.tsx`.
- Remover import/uso de `BrainWidget` e de `useFeatureAccess("brain")` nesta rota (componente segue existindo para outras telas).
- Lista construída com a tabela shadcn existente (`@/components/ui/table`) dentro de `DashboardPanelSurface`; estado de ordenação local (`sortKey`, `sortDir`) via `useMemo`, sem mudar as chamadas a `listProjects`.
- Filtro de cliente usa `Command`/`Popover` (combobox) já disponíveis; remove-se o `disabled={!!activeClientId}` e o `useEffect` que força o valor a cada mudança passa a definir apenas o valor inicial.
- KPIs no topo permanecem como estão.

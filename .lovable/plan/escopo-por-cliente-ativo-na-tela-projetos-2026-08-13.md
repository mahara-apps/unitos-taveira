# Escopo por cliente ativo na tela Projetos

Com um cliente selecionado no seletor da sidebar (ex.: Café Aurora), a tela de Projetos deve mostrar **somente** os projetos daquele cliente. Nada de listar projetos de outros clientes.

## O que muda

1. **Trava no cliente da sidebar**
   - Quando há cliente ativo, o filtro de cliente da tela passa a ser sempre igual a ele e não pode ser alterado nesta tela.
   - O combobox de cliente deixa de aparecer; em seu lugar entra um indicador somente-leitura: "Cliente: Café Aurora" com a cor do cliente e a nota de que a troca é feita no seletor da sidebar.
   - O chip removível de cliente e o "Limpar filtros" não removem mais esse escopo (só limpam busca, status e responsável).

2. **Modo agência (nenhum cliente na sidebar)**
   - Mantém o combobox com busca por nome + "Todos os clientes", como está hoje.

3. **Coerência dos números**
   - KPIs, contador de resultados e lista continuam vindo do mesmo escopo, agora sempre restrito ao cliente ativo.
   - A coluna "Cliente" da tabela é ocultada quando há cliente ativo (informação redundante), liberando espaço para nome do projeto e período.

## Detalhes técnicos

- Arquivo: `src/routes/_authenticated/projects.index.tsx`.
- `clientFilter` volta a ser derivado de `activeClientId` quando ele existe (sincronizado via efeito), e o `clientId` enviado a `listProjects` passa a ser `activeClientId ?? (clientFilter === "all" ? null : clientFilter)`.
- Renderização condicional: `activeClientId` presente → badge de escopo; ausente → `ClientFilterCombobox`.
- Sem mudanças de backend/RLS: `listProjects` já filtra por `clientId`.

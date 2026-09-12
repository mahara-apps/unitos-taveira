# Reformulação da apresentação do Plano de Mídia

## Objetivo
Substituir a grade horizontal atual por uma experiência legível em cartões, mantendo uma visão de planilha compacta e preservando integralmente os dados e ações já existentes. A mudança ficará restrita a `/customers/:id/media-plan`.

## Implementação

### 1. Resumo de orçamento
- Usar `PageKpi`/`PageKpiGrid`, conforme o design system, para exibir:
  - Orçamento mensal, mantendo sua edição atual.
  - Total alocado em R$ e percentual.
  - Total disponível em R$ e percentual, incluindo tratamento visual para orçamento excedido.
- Adicionar abaixo uma barra empilhada com Topo, Meio, Fundo e saldo livre.
- Calcular todos os valores a partir do orçamento e dos itens já retornados, sem alterar dados ou regras de persistência.

### 2. Visão principal em cartões
- Tornar `Cartões` a visão padrão e adicionar o alternador `Cartões | Planilha` no topo.
- Agrupar os investimentos por Topo, Meio e Fundo, respeitando os filtros atuais de etapa e canal.
- Exibir no cabeçalho de cada grupo quantidade, subtotal em R$ e percentual.
- Criar um cartão por investimento com:
  - Barra lateral na cor semântica da etapa.
  - Produto/serviço e chip de canal no topo.
  - Chips de campanha, etapa e objetivo.
  - Investimento em R$ e percentual em destaque.
  - KPI e público na base.
  - Ações de editar, excluir e reordenar, preservando a ordenação atual.
- Manter grupos vazios utilizáveis, com ação para adicionar um investimento já associado à etapa correspondente.

### 3. Painel lateral para criar e editar
- Remover a edição automática dentro das células.
- Abrir o mesmo painel lateral à direita ao editar um cartão, clicar numa linha ou usar `Adicionar linha`.
- Organizar os 12 campos existentes, sem criar ou remover nenhum:
  - **Identificação:** produto/serviço, tipo de campanha, etapa e canal.
  - **Objetivo e meta:** objetivo e KPI.
  - **Investimento:** percentual e valor em R$ calculado.
  - **Segmentação e referências:** público, palavras-chave, benchmark e outras referências.
- Ao alterar o percentual, recalcular imediatamente o valor em R$ e o saldo livre, desconsiderando o próprio item durante uma edição.
- Validar o formulário antes de salvar e manter os botões `Cancelar` e `Salvar` fixos na base.
- Persistir somente ao salvar; cancelar não modifica o item.

### 4. Visão Planilha enxuta
- Exibir somente produto, canal, campanha, objetivo, KPI, público, percentual e valor.
- Manter a coluna de produto fixa durante a rolagem horizontal.
- Agrupar linhas por etapa, com subtotal por grupo e total geral.
- Permitir expandir cada linha para consultar palavras-chave, benchmark e outras referências.
- Abrir o painel lateral ao clicar/editar uma linha, sem edição inline.
- Preservar reordenação e exclusão por ações explícitas, sem remover recursos existentes.

### 5. Design system e adaptação de tela
- Reutilizar `Button`, `Input`, `Select`, `Textarea`, `Badge`, `Sheet`, `PageKpi` e componentes de expansão existentes.
- Registrar as cores de funil no tema global como tokens semânticos equivalentes a Topo `#0ea5e9`, Meio `#8b5cf6` e Fundo `#16a34a`, com contraste adequado nos temas claro e escuro.
- Adaptar cartões, controles, planilha e painel lateral para telas pequenas sem estouro horizontal incoerente.
- Não alterar a tela pública compartilhada, outras rotas, banco, funções de servidor ou modelo de dados.

## Preservação funcional
- Manter filtros por etapa e canal.
- Manter seleção/criação/exclusão de planos, edição do orçamento, aprovação/reabertura e compartilhamento.
- Manter criação, edição, exclusão e reordenação de investimentos.
- Manter estratégia do plano e todos os estados de carregamento, erro e vazio.

## Validação
- Cobrir cálculos de orçamento, agrupamento/subtotais e conversão entre formulário e os 12 campos.
- Testar criação, edição, cancelamento, exclusão, expansão da planilha, filtros, alternância de visão e reordenação.
- Conferir visualmente a rota em desktop e mobile, incluindo tema escuro, painel lateral e coluna fixa.
- Executar verificação de tipos, testes focados, build, inspeção de diferenças e `bun run master:check`.
- Seguir o fluxo MASTER-first: regenerar o pacote, sincronizar a versão do MASTER e deixar a publicação/propagação claramente indicada caso não seja executada neste trabalho.

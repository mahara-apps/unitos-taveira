# Corrigir o modal em branco ao criar/abrir tarefas

## Diagnóstico confirmado

A tela abre o detalhe usando apenas a lista já filtrada (`allTasks={filtered}`). No endereço informado, a visualização é **Minhas tarefas**. Porém, o formulário permite criar a tarefa sem responsável e, após a criação, abre imediatamente o novo `taskId`. Essa tarefa não pertence à lista filtrada e também pode ainda não ter chegado na atualização da listagem; por isso o modal não encontra o registro e permanece indefinidamente em “Carregando...”. O mesmo risco existe em links diretos para tarefas ocultas pelo filtro atual.

## Implementação

1. Criar uma leitura individual de tarefa por ID, protegida pela sessão, RBAC/RLS e escopo em cascata já adotados pelo sistema.
2. Fazer o modal carregar a tarefa pelo ID quando ela não estiver disponível na lista atual, sem depender de visualização, filtros, ordenação ou tempo de atualização da lista.
3. Reaproveitar imediatamente os dados da lista quando presentes, evitando carregamento desnecessário.
4. Substituir o carregamento infinito por estados explícitos:
   - carregando enquanto a consulta está em andamento;
   - mensagem com ação para fechar quando a tarefa não existir ou estiver fora do escopo;
   - conteúdo normal quando a tarefa for encontrada.
5. Após criar uma tarefa, atualizar a lista e abrir o detalhe normalmente, inclusive em **Minhas tarefas** quando ela estiver sem responsável ou atribuída a outra pessoa.
6. Revisar todas as entradas do detalhe — criação, clique nas diferentes visualizações e link direto com `taskId` — para impedir a mesma falha em outros pontos.

## Validação

- Cobrir em testes: tarefa presente na lista, ausente pelo filtro, recém-criada, link direto, arquivada e inacessível por escopo.
- Simular Owner/Admin, Manager e User, preservando as restrições de cliente e workspace.
- Validar criação com e sem responsável nas visualizações Lista, Minhas, Kanban, Timeline e Calendário.
- Confirmar fechamento, navegação anterior/próxima, comentários, subtarefas e timesheet após o carregamento individual.
- Executar testes direcionados, verificação de tipos, build e checagens de segurança.

## MASTER-first

Aplicar a correção no MASTER, incluir os testes no pacote propagável, regenerar o delta, sincronizar a versão do MASTER e do pacote, executar `bun run master:check`, publicar o MASTER e atualizar a Taveira. A versão só será considerada aplicada após o deployment Git ficar `READY`.

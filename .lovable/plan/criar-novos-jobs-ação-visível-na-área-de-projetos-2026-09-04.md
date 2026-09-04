# Criar novos Jobs: ação visível na área de Projetos

A criação de job já existe no backend (`createJobFn`) e na UI, mas o único gatilho é um ícone “+” pequeno, sem rótulo, dentro da coluna estreita da lista de Jobs — e ele não existe na Visão geral. Por isso parece que só é possível criar tarefas.

## O que muda (somente UI)

1. **Botão “Novo job” com rótulo na barra superior do painel**, ao lado da busca, visível no modo Jobs. Abre o mesmo campo de nome já existente.
2. **Botão “Novo job” também na Visão geral**, junto ao cartão “Jobs”: cria o job e leva direto para o modo lista, sem precisar navegar antes.
3. **Estado vazio acionável**: quando não há nenhum job, o texto “Nenhum job ainda…” passa a ter um botão “Criar primeiro job”.
4. O ícone “+” da coluna lateral continua funcionando (mesmo estado `addingJob`), agora com tooltip/rótulo acessível.
5. Campo de nome ganha foco automático, confirma com Enter, cancela com Esc (comportamento atual) e mostra estado de carregamento enquanto salva.

## Garantias

- Nenhuma alteração de banco, RLS, RBAC, funções server-side ou regras de negócio.
- Reaproveita `createJobMut` / `createJobFn` e a invalidação de cache já existentes.
- Job virtual “Pautas” permanece não criável/renomeável.

## Detalhes técnicos

- Alteração concentrada em `src/components/projects/jobs-panel.tsx`: novos gatilhos ligados a `setAddingJob(true)` (com `setMode("jobs")` quando disparado da visão geral), botão no estado vazio e `disabled`/label de progresso em `createJobMut.isPending`.
- Tokens semânticos do design system; sem novas dependências.

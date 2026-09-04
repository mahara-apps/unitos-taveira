# Projeto = execução da pauta

Hoje o projeto criado a partir da pauta nasce vazio e a tela dele é um formulário de cadastro. A pauta e o projeto não se conversam. A proposta é transformar o projeto na tela de execução da pauta.

## Causa confirmada do "projeto vazio"

Ao aprovar a pauta, dois caminhos rodam separados:

- criação do projeto (vincula projeto ↔ pauta);
- materialização dos itens da pauta em cards de conteúdo (posts).

Os posts criados a partir dos tópicos da pauta são gravados **sem `project_id`**. A tela do projeto lista peças filtrando por `project_id`, por isso mostra 0 peças, 0% de progresso e "Nenhum item vinculado".

## O que muda

### 1. Vínculo real dos itens (backend)

- Ao materializar a pauta, os posts passam a gravar o `project_id` do projeto da pauta (criando o projeto antes, se ainda não existir).
- Correção retroativa: posts já criados a partir de tópicos de uma pauta que tem projeto recebem o `project_id` correspondente.
- A tela do projeto passa a listar também os **tópicos da pauta que ainda não viraram peça**, para o projeto refletir 100% do escopo aprovado.

### 2. Tela do projeto simplificada

Estrutura nova, de cima para baixo:

```text
[voltar]  Nome do projeto            [Ver pauta] [⋯ mais]
Cliente • Período • Responsável • Status (badge/pauta)

[ Progresso: X de Y peças concluídas ————————— 42% ]
  peças: total / em produção / aprovadas / publicadas

[ ITENS DA PAUTA NESTE PROJETO ]
  linha: título • canal • formato • etapa atual • responsável
  (item sem peça criada aparece como "pendente de produção" com ação criar)

[ TAREFAS DO PROJETO ]
```

Removido/recolhido da área principal:
- edição inline de nome/descrição, seletor de cor, campo de objetivos/metas, datas soltas e o painel de Jobs viram um painel "Configurações do projeto" (modal), fora do fluxo de leitura;
- KPIs de 4 cards viram uma faixa única de progresso com contadores;
- ações destrutivas (arquivar/excluir) saem do topo e vão para o menu "⋯".

### 3. As telas conversam

- Projeto → pauta: link "Ver pauta" com badge de status (mantido e mais visível).
- Pauta → projeto: bloco fixo no topo da pauta com o projeto vinculado, progresso e link.
- Item da pauta → peça: cada linha do projeto abre a peça no Kanban de conteúdo; peça aberta mostra de qual item da pauta veio.
- Cliente → projeto: a aba de Projetos do cliente aponta para o projeto da pauta do mês.

## Detalhes técnicos

- `src/lib/monthly-plan-kanban.server.ts`: chamar `ensurePlanProject` e incluir `project_id` nas linhas inseridas em `posts`.
- Migração de dados (UPDATE) para preencher `project_id` em posts órfãos via `monthly_plan_topic_id` → `monthly_plan_topics.monthly_plan_id` → `projects.monthly_plan_id`.
- `src/lib/projects.functions.ts` (`getProject`): retornar também os tópicos da pauta vinculada com o post correspondente (ou nulo) e recalcular `stats` sobre esse conjunto.
- `src/routes/_authenticated/projects.$projectId.tsx`: reescrita da composição; formulário de cadastro extraído para um modal de configurações.
- `src/components/monthly-plan/monthly-plan-view.tsx`: bloco do projeto vinculado no topo.
- Nenhuma alteração de schema é necessária além do UPDATE de correção.

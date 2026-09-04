# Projetos não aparecem na Taveira — diagnóstico e correção

## O que já foi verificado no código

A tela de Projetos e o seletor de projeto da Pauta leem a **mesma tabela**, com os
mesmos filtros de workspace e cliente, e com as mesmas regras de acesso. Ou seja: se o
projeto aparece na Pauta, a permissão e o vínculo com o cliente estão corretos.

A diferença entre as duas leituras é que a tela de Projetos, além do projeto, busca
junto: o vínculo com a pauta (por nome da chave estrangeira `projects_monthly_plan_id_fkey`),
as publicações do projeto e as etapas do fluxo de conteúdo. Se **qualquer uma** dessas
peças estiver faltando ou sem permissão no banco da Taveira, a leitura inteira falha e
a lista fica vazia/erro — mesmo com os projetos existindo.

Isso é uma hipótese, ainda **não confirmada** no banco da Taveira. O plano começa
confirmando.

## Etapa 1 — Diagnóstico no ambiente da Taveira (somente leitura)

Rodar uma verificação read-only no banco daquela instalação, usando as credenciais já
guardadas no painel de instalações, checando:

1. Se a chave estrangeira `projects_monthly_plan_id_fkey` existe em `projects`.
2. Se `monthly_plans`, `posts`, `content_pipeline_stages` e `projects` têm permissão
   de leitura para usuários autenticados.
3. Quantos projetos existem por cliente e workspace (para confirmar que os dados estão lá).
4. Se o cache de esquema da API do banco está atualizado (embeds resolvendo).

Resultado esperado: uma causa única e nomeada, não um palpite.

## Etapa 2 — Correção conforme o achado

- **Se faltar a chave estrangeira / permissão:** aplicar migração corretiva no banco da
  Taveira (criar a FK e/ou os GRANTs) e recarregar o cache de esquema. Incluir essa
  verificação na validação final do provisionamento, para nenhuma instalação nova nascer
  com essa falha.
- **Se os dados estiverem em outro workspace/cliente do que a tela consulta:** corrigir o
  escopo, não o dado.

## Etapa 3 — Blindagem da tela (vale para todas as instalações)

Independente da causa, a lista de projetos deixa de depender de uma única consulta
combinada:

- O vínculo com a pauta passa a ser buscado em consulta separada e opcional: se falhar,
  os projetos continuam aparecendo (apenas sem o selo da pauta).
- Idem para as estatísticas de publicações: falha nelas mostra "—" no progresso, sem
  esconder o projeto.
- A mensagem de erro passa a dizer o motivo técnico real em vez de "nenhum projeto".

## Detalhes técnicos

- `src/lib/projects.functions.ts`: `listProjects` e `getProject` deixam de usar o embed
  fixado no nome da FK (`monthly_plans!projects_monthly_plan_id_fkey`); passam a buscar
  `monthly_plans` por `in("id", ids)` em consulta própria, com `try/catch` tolerante.
  Estatísticas de `posts`/`loadStageMap` também em bloco tolerante.
- `src/routes/_authenticated/projects.index.tsx`: estado de erro parcial (projetos
  carregados, extras indisponíveis).
- Diagnóstico da Etapa 1 via as credenciais por instalação já existentes
  (`installation_credentials` + `credentials.server.ts`), em modo leitura.
- Etapa 2, se necessária: migração corretiva aplicada ao banco de destino e checagem
  adicionada em `supabase/install/verify-installation.sql`.
- Nenhuma mudança em RBAC/RLS de leitura de projetos.

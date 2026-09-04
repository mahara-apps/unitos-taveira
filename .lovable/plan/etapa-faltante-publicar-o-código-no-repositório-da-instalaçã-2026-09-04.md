# Etapa faltante: publicar o código no repositório da instalação

Hoje o provisionamento nunca coloca código no repositório informado no cadastro: o
projeto de deploy é ligado direto ao repositório do MASTER, e o repositório da
instalação é só um metadado. Também a ordem começa pelo banco, antes de existir
código/URL própria. Vamos corrigir as duas coisas.

## Nova ordem do provisionamento (11 etapas)

```text
01 Supabase destino        projeto, chaves e extensões (sem aplicar schema)
02 Código no GitHub        cria o repositório da instalação a partir do template
                           do MASTER e fixa o commit publicado
03 Deploy conectado        liga o projeto de deploy ao repositório DA INSTALAÇÃO,
                           com auto-deploy por Git desligado
04 Secrets próprios        gerados e exclusivos da instalação
05 Variáveis + publicação  grava todas as variáveis e dispara o primeiro build,
                           resolvendo a URL operacional
06 Banco + RLS + funções   baseline aplicado no destino
07 Storage                 buckets e policies
08 Seeds de catálogo       catálogo, sem dado de negócio
09 Brain stats             view inicial
10 Cron na própria origem  agendado só depois da URL responder
11 Validação final         verify-installation.sql
```

Etapas já concluídas em execuções anteriores continuam sendo puladas: o
provisionamento segue idempotente e pode ser repetido.

## Como o código chega ao repositório

- O repositório de referência do MASTER precisa estar marcado como **template**
  no GitHub (ajuste único, feito uma vez).
- O MASTER cria o repositório da instalação a partir desse template, no dono/nome
  indicados no cadastro. Se o repositório já existir, ele é reaproveitado.
- O commit publicado é lido e registrado como versão fixada da instalação; é ele
  que aparece no card *Versão e atualizações*.
- Atualizações futuras continuam exigindo autorização explícita do Super Admin:
  o MASTER publica o snapshot do commit autorizado no repositório da instalação e
  só então dispara o build.

## Credencial nova

- `UNITOS_GITHUB_TOKEN` (secret do MASTER, com permissão de criar/gravar
  repositórios na conta das instalações).
- Sem ele a etapa 02 aparece **BLOCKED** com o motivo e nada depois roda —
  ausência de credencial nunca vira sucesso, como nas demais etapas.

## Detalhes técnicos

- `automation-contract.ts`: nova capability `github`
  (`UNITOS_GITHUB_TOKEN`), reordenação de `AUTOMATED_PROVISION_PLAN` com os ids
  novos `code` e `deploy_link`, e parser puro da URL do repositório em
  `owner/repo` (recusando qualquer referência ao MASTER e ao repo do MASTER).
- `automation.server.ts`: novo `createCodeClient` (GitHub REST) com
  `ensureRepo` (`POST /repos/{template}/generate`, tolerando 422 “name already
  exists”), `currentSha` (`GET /repos/{owner}/{repo}/commits/{branch}`) e
  `publishSnapshot(sha)` para atualização — blobs/tree/commit/ref a partir do
  tarball do commit autorizado do MASTER.
- `createDeployClient.deployLatestCode`/link passa a usar o repositório da
  instalação (`repo` derivado do cadastro) em vez de `UNITOS_MASTER_REPO`;
  `setAutoDeploy(false)` continua obrigatório.
- Runner: geração de secrets e `buildDeployEnvPlan` passam para antes das etapas
  de banco; as chaves do Supabase vêm da etapa 01 (leitura de chaves), que não
  depende do schema.
- `manager-contract.ts`: `gitRepoUrl` passa a ser obrigatório e validado no
  cadastro (hoje só é exigido no checklist manual).
- Migration: nenhuma. Só colunas já existentes (`git_repo_url`,
  `version`, `checks`) e um novo id de check `code` no jsonb de progresso.
- Testes: `tests/installation-automation.unit.test.ts` (ordem das etapas,
  BLOCKED sem token, link apontando para o repo da instalação) e um novo
  `tests/installation-code-publish.unit.test.ts` (parser owner/repo, recusa do
  repo do MASTER, idempotência do ensureRepo, publicação por SHA).
- Documentação: `docs/CHECKLIST_NOVA_INSTALACAO.md` e
  `supabase/install/README.md` atualizados com a nova ordem, o template e o
  `UNITOS_GITHUB_TOKEN`.

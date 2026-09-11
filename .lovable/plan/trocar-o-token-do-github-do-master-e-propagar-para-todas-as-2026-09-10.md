# Trocar o token do GitHub do MASTER e propagar para todas as instalações

## Contexto (verificado no código)

O token do GitHub é usado em dois lugares:

1. **Segredo do MASTER** — `UNITOS_GITHUB_TOKEN`, guardado nos secrets da instalação MASTER. É ele que lê o repositório-template `mahara-apps/unitos-master` e serve de reserva quando uma instalação não tem token próprio.
2. **Cópia por instalação** — cada instalação pode ter o seu `githubToken` cifrado (AES-256-GCM) em `installation_credentials`. Quando existe, essa cópia tem prioridade sobre o segredo global. Como o token antigo foi revogado/regenerado, todas essas cópias ficaram inválidas — só trocar o segredo do MASTER não basta.

## O que vamos fazer

### 1. Atualizar o segredo do MASTER
Você cola o token novo uma única vez no formulário seguro de secrets (`UNITOS_GITHUB_TOKEN`). O valor nunca passa pelo chat.

### 2. Botão "Aplicar token do MASTER nas instalações"
Na tela de Instalações (só Super Admin), uma nova ação que:

- lê o token atual do segredo `UNITOS_GITHUB_TOKEN` do servidor (sem exibi-lo);
- grava-o cifrado em `installation_credentials.github_token_ciphertext` de todas as instalações ativas, reutilizando o mesmo cofre e a mesma função de gravação já existentes;
- mostra o resultado por instalação: atualizada ou motivo da falha;
- registra a operação na auditoria (quem aplicou, quando, em quais instalações) — nunca o valor do token.

### 3. Verificação imediata
Após a propagação, o "Testar acesso" de cada instalação comprova a gravação de verdade no repositório (o probe real já existente), confirmando que o token novo cobre todos os repositórios.

## Pré-requisito no GitHub (você confirma uma vez)

O token novo precisa ter, em **Repository permissions**:
- `Contents: Read and write`
- `Metadata: Read-only`

E em **Repository access**: todos os repositórios das instalações (`unitos-master`, `unitos-taveira`, `unitos-casa8`, etc.) — ou "All repositories" da organização mahara-apps.

## Detalhes técnicos

- `src/lib/installation/manager.functions.ts`: nova server function `propagateMasterGithubTokenFn` (Super Admin, confirmação crítica com digitação — é ação em massa sobre credenciais); grava via `saveInstallationCredentials` existente.
- `src/components/installations/`: botão na listagem de instalações + resumo do resultado.
- Nenhuma migration, nenhuma mudança de RLS: reusa `installation_credentials` e o cofre AES-256-GCM já existentes.
- Testes: propagação cifrada em lote, recusa para não Super Admin, e falha individual não derrubando o lote.
- MASTER-first: regenerar pacote/delta, sincronizar `delta_version.txt` + `MASTER_RELEASE_VERSION`, `bun run master:check`, publicar.

## Ordem de execução

1. Você salva o token novo no formulário seguro (eu abro aqui).
2. Eu implemento o botão de propagação + testes e publico o MASTER.
3. Você clica no botão uma vez e todas as instalações passam a usar o token novo.
4. Rodamos o "Testar acesso" na Casa 8 e nas demais para confirmar.

# Auditoria: versão exibida no ambiente e consulta do MASTER

## O que foi verificado agora

1. **"Versão do sistema 1.0" na tela Administração → Informações do ambiente**
   O valor é um texto fixo escrito no código dessa tela (`APP_VERSION = "1.0"`).
   Ele nunca mudou desde que a tela foi criada e não tem relação com a versão
   real do sistema. Por isso a Taveira mostra `1.0` enquanto o painel de
   Instalações mostra corretamente `v1.2.4` (que é a versão de verdade).
   Não é um problema de banco nem de propagação.

2. **"HTTP 403 ao consultar o commit do MASTER" (aba Versões)**
   A consulta ao repositório do MASTER é feita sem credencial: só envia o
   cabeçalho de formato, sem o token do GitHub. Como o repositório do MASTER
   não é público, o GitHub responde 403. Existe no mesmo arquivo outra rotina
   equivalente que já usa o token corretamente — a do cartão "Disponível no
   MASTER" ficou de fora. Efeito: o cartão mostra erro em vez do commit, mesmo
   com a instalação em dia (a comparação de versão em si continua correta).

3. **Pacote MASTER (propagação)**
   Está em dia: 53 migrações no pacote, impressão digital do
   `007_delta_migrations.sql` idêntica à registrada em `delta_version.txt`, e
   `MASTER_RELEASE_VERSION` = `1.2.4` = mesma versão do arquivo. Nenhuma
   alteração recente ficou fora do pacote. A instalação da Taveira já está
   operacional e saudável em `1.2.4`.

## O que será corrigido

1. A tela de Informações do ambiente passa a exibir a versão real do sistema
   (a mesma que o painel de Instalações usa), no cartão "Versão" e na linha
   "Versão do sistema" — sem número escrito à mão.
2. A consulta do commit do MASTER passa a usar o token do GitHub, e quando o
   token não estiver configurado a mensagem explica isso em vez de mostrar
   "HTTP 403".
3. Uma verificação automática garante que a versão exibida na tela de ambiente
   nunca volte a ser um número fixo divergente da versão do MASTER.
4. Fechamento MASTER-first: regenerar o pacote, subir a versão para `1.2.5`
   em `delta_version.txt` e `MASTER_RELEASE_VERSION`, rodar `bun run master:check`,
   typecheck e build. Depois disso é só publicar o MASTER e autorizar
   "Atualizar" na Taveira.

## Detalhes técnicos

- `src/routes/_authenticated/admin.ambiente.tsx`: remover `APP_VERSION = "1.0"`
  e usar `MASTER_RELEASE_VERSION` de `@/lib/installation/manager-contract`
  (módulo puro, seguro no cliente).
- `src/lib/installation/automation.server.ts`, `createDeployClient.latestCommit`:
  aceitar `githubToken` e enviar `authorization: Bearer …` (mesmo padrão de
  `createCodeClient.masterHeadSha`); sem token, retornar erro explicativo.
- `src/lib/installation/manager.functions.ts` (linha ~1037 e demais chamadas de
  `createDeployClient` que usam `latestCommit`): repassar `UNITOS_GITHUB_TOKEN`.
- Teste novo em `tests/`: a tela de ambiente não contém versão literal e a
  chamada do commit inclui autorização.
- Nenhuma migração de banco necessária; nada muda em RBAC/RLS, credenciais ou
  no banco da Taveira.

# Token do Supabase por instalação (BYOK) no cadastro

## O que já existe hoje (verificado no código)

- Cada instalação já pode ter os seus próprios acessos guardados cifrados (AES-256-GCM) na tabela `installation_credentials`, incluindo o token do Supabase.
- O provisionamento já busca esse token no banco e, quando existe, ele tem prioridade sobre o token global do MASTER (`resolveInstallationEnv`), injetando-o nas chamadas da Management API.
- Os valores nunca voltam em claro para a tela: só máscara e "configurado sim/não".

Ou seja: o armazenamento seguro e a injeção dinâmica já estão prontos. Falta o que você pediu no cadastro e a exigência do token nas novas instalações.

## O que muda

1. **Cadastro de nova instalação**: novo campo "Supabase Access Token", com o olho para mostrar/ocultar, **obrigatório**. Junto dele, o link direto para gerar o token no painel do Supabase e o aviso de que o valor é guardado cifrado e nunca mais exibido.
2. **Gravação atômica**: ao cadastrar, a instalação é criada e o token é gravado cifrado no mesmo passo. Se a gravação do token falhar, o cadastro é desfeito para não deixar instalação sem acesso.
3. **Exigência só nas novas**: instalações criadas a partir de agora ficam marcadas como BYOK. Para elas, o provisionamento não usa mais o token global — se o token próprio estiver faltando ou ilegível, a operação para antes de qualquer chamada, com mensagem em português dizendo exatamente o que preencher e onde.
4. **Instalações existentes**: continuam funcionando como hoje (token próprio tem prioridade, global como reserva). Na tela de cada uma, um aviso discreto sugere cadastrar o token próprio.
5. **Tela da instalação**: o cartão de acessos passa a mostrar se aquela instalação é BYOK e, quando for, deixa claro que o token é indispensável.

## Alterações no banco

Uma migration só, sem apagar nada:

- `installations`: nova coluna `requires_own_supabase_token` (booleano, padrão `false`). Linhas existentes ficam `false`; o cadastro novo grava `true`.
- Nenhuma nova tabela: o token continua em `installation_credentials.supabase_management_token_ciphertext`, que já existe, já é cifrado e já tem RLS restrita a Super Admin.
- Nenhuma mudança de RLS, de permissões ou de outra coluna.

## Detalhes técnicos

- `manager.functions.ts`: `createInstallationFn` passa a aceitar `supabaseManagementToken` (obrigatório, validado como não vazio), grava via `saveInstallationCredentials` e faz rollback do insert em caso de erro; o registro em `installation_operations` continua sem qualquer segredo.
- `credentials.server.ts`: `resolveInstallationEnv` recebe a flag da instalação; quando `requires_own_supabase_token` é `true`, o token global do Supabase é removido do env resolvido, de modo que a falta do token próprio falhe de forma explícita em vez de usar o do MASTER.
- `automation-contract.ts`: mensagem de credencial ausente adaptada para o caso BYOK (aponta o cartão de acessos da instalação, não a variável de ambiente).
- UI: `admin.instalacoes.index.tsx` (campo no diálogo, com `PasswordInput`) e `installation-credentials-card.tsx` (selo/aviso BYOK).
- Testes: caso do cadastro exigindo token e caso do provisionamento BYOK sem token próprio não caindo no token global.
- MASTER-first: migration no MASTER, delta regenerado, `delta_version.txt` + `MASTER_RELEASE_VERSION` em 1.3.23, nova checagem em `verify-installation.sql` para a coluna, e `bun run master:check` antes de publicar.

## Fora do escopo

Vercel, GitHub e demais acessos seguem exatamente como estão; nenhuma rota, permissão ou integração existente é removida.

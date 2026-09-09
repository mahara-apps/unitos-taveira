# Corrigir o erro de limite do GitHub e validar chaves/permissões no formulário

## O que aconteceu (confirmado no código)

A falha da tela não é falta de permissão do Supabase. A mensagem real é:

```text
HTTP 403 ao ler src/components/installations/operation-views.tsx do MASTER
{"message":"API rate limit exceeded for user ID 264655603"}
```

Hoje o código do MASTER é lido com **o token do repositório da própria
instalação**. Como a publicação lê arquivo por arquivo, esse token estoura o
limite de uso por hora do GitHub. A repetição automática existente espera no
máximo 8 segundos, e o limite só libera na virada da hora — então a operação
termina em erro. O rótulo "Falhou em: Supabase" está errado: o passo que
quebrou foi o do código.

## O que vai ser feito

1. **Ler o MASTER com a chave do MASTER.** A leitura do código-fonte passa a
   usar a credencial do próprio MASTER; o token da instalação fica só para
   gravar no repositório dela. Isso divide o consumo entre duas contas e evita
   o estouro.
2. **Menos leituras por publicação.** Reaproveitar a listagem já em cache e o
   progresso salvo, evitando reler arquivos que não mudaram.
3. **Tratar limite de uso como espera, não como falha.** Quando o GitHub
   responder "limite excedido", a operação informa o horário de liberação, fica
   em "atenção" e é retomada automaticamente depois desse horário, mantendo o
   progresso.
4. **Mensagem correta por etapa.** O erro deixa de aparecer com o nome de outra
   etapa: passa a dizer "Código no GitHub — limite de uso da conta atingido,
   libera às HH:MM".
5. **"Testar acesso" verifica permissão por permissão.** Em vez de um resultado
   único, mostra uma lista com o que passou e o que falta:
   - Banco: conexão ao projeto e leitura das chaves do projeto.
   - Deploy: acesso ao projeto, à equipe e permissão de publicar.
   - Repositório: leitura do MASTER, leitura/gravação no repositório da
     instalação, criação de repositório e quanto ainda resta do limite de uso.
6. **Formulário explica exatamente o que cada chave precisa.** Cada campo passa
   a ter um bloco curto de requisitos, com o texto abaixo, além do link para
   gerar a chave.

## Texto de requisitos que entra no formulário

**Token de gestão do banco (Supabase)**
- A conta precisa ser Owner ou Administrator do projeto.
- Precisa permitir ler as chaves de API do projeto.
- Sem isso: banco, chaves e schema não são aplicados.

**Token de deploy (Vercel)**
- Criado na conta que é dona do projeto de publicação.
- Se o projeto estiver em uma equipe, informe também a equipe.
- Precisa permitir criar publicações e alterar variáveis do projeto.

**Equipe de deploy (opcional)**
- Só quando o projeto pertence a uma equipe; caso contrário, deixe vazio.

**Token do repositório (GitHub)**
- Token de acesso pessoal com validade e acesso ao dono/organização do
  repositório da instalação.
- Permissões: Metadados (leitura), Conteúdo (leitura e gravação),
  Administração (leitura e gravação, para criar o repositório) e
  Fluxos de trabalho (gravação, se o repositório usar automações).
- Leitura do repositório do MASTER não é mais exigida deste token.
- Evite reutilizar o mesmo token em várias instalações: o limite de uso do
  GitHub é por conta e é justamente o que causou a falha atual.

## Detalhes técnicos

- `src/lib/installation/automation.server.ts`: `createCodeClient` recebe
  `masterToken` opcional e usa cabeçalhos distintos para chamadas ao MASTER e
  ao destino; novo reconhecimento de `x-ratelimit-remaining`/`x-ratelimit-reset`
  e de `API rate limit exceeded`, retornando um resultado do tipo
  "aguardando liberação" (com `resetAt`) em vez de erro terminal;
  `publishSnapshot` propaga esse estado como `partial` com motivo.
- `src/lib/installation/manager.functions.ts`: todas as chamadas a
  `createCodeClient` passam o token global do MASTER (`UNITOS_GITHUB_TOKEN` do
  ambiente MASTER) como `masterToken` e o token da instalação como `token`;
  `testInstallationCredentialsFn` retorna uma lista de checagens
  (`{ area, label, ok, detail }[]`) mantendo os campos atuais para
  compatibilidade.
- `src/lib/installation/resume-worker.server.ts`: respeita `resetAt` antes de
  retomar operações barradas por limite de uso.
- `src/components/installations/installation-credentials-card.tsx`: campos com
  `requirements: string[]`, renderizados como lista, e resultado do teste
  exibido em lista por permissão.
- `src/components/installations/operation-views.tsx`: rótulo do erro passa a
  usar a etapa que realmente falhou.
- Testes: limite de uso do GitHub vira espera retomável (não falha);
  leitura do MASTER usa o token do MASTER; teste de acesso lista permissões
  faltantes.
- MASTER-first: sem migration. Regenerar o pacote, subir
  `MASTER_RELEASE_VERSION` e `delta_version.txt` para 1.3.31, rodar
  `bun run master:check`, publicar e autorizar as instalações.

## Fora de escopo

Nada de mudança em RBAC, banco ou fluxo de negócio; o provisionamento continua
com as mesmas etapas e a mesma ordem.

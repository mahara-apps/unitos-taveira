# Conexão Meta — resolver de forma definitiva

Dois problemas distintos estão acontecendo ao mesmo tempo.

## O que foi verificado

1. **"URL bloqueada" no login** — o sistema envia sempre a URL fixa gravada em `META_REDIRECT_URI`:
   `https://origin-blossom-kit.lovable.app/api/public/meta/callback`.
   O código tem como fallback uma URL de domínio próprio (`unitos.sejaumpartner.com`) que **não está ativa** neste projeto. Ou seja: o Meta só aceitará o login quando essa URL exata estiver na lista de URIs válidos do app.
2. **"Falha ao descriptografar o token da Meta"** — a sessão que o seletor de contas está usando foi criada em **21/07** (tabela `meta_oauth_sessions`), mas continua sendo tratada como válida porque a data de expiração foi estendida. O token dela foi cifrado com a chave de criptografia anterior, então hoje não abre. Como o login novo está bloqueado no Meta, o sistema cai nessa sessão velha e mostra o erro sem saída.

## O que será feito

### 1. Sessão inválida deixa de ser um beco sem saída
- Quando a descriptografia do token falhar, a sessão é invalidada automaticamente (expira na hora) e a resposta passa a sinalizar "precisa reconectar".
- O seletor de contas, ao receber esse sinal, dispara o fluxo de login do Meta novamente em vez de mostrar erro vermelho com "Tentar novamente" que nunca funciona.
- `getActiveMetaSession` passa a validar se o token é realmente utilizável antes de devolver a sessão, evitando reaproveitar sessões antigas.

### 2. Login funcionando em produção e no preview
- A URL de redirecionamento passa a ser derivada da origem da requisição, restrita a uma lista segura (domínio publicado, domínio de preview do projeto e `META_REDIRECT_URI`), com `META_REDIRECT_URI` como padrão.
- Assim, conectar a partir do preview volta para o preview e conectar em produção volta para produção — sem token perdido entre ambientes.
- Remoção do fallback fixo para o domínio inativo, que hoje mascara erro de configuração.

### 3. Mensagens de erro do Meta mais claras
- Erro de URI não autorizada passa a exibir a URL exata que o sistema enviou, para conferência de um clique no painel do Meta.

## Ação necessária no painel do Meta (não é código)

Em **Meta for Developers → Login do Facebook → Configurações**, ativar "Login do OAuth do cliente" e "Login do OAuth da Web" e adicionar em **URIs de redirecionamento do OAuth válidos**:

```text
https://origin-blossom-kit.lovable.app/api/public/meta/callback
https://id-preview--3f33732a-cb8b-43ae-84fb-01d9e367fb0c.lovable.app/api/public/meta/callback
```

Em **Configurações → Básico → Domínios do app**, adicionar `origin-blossom-kit.lovable.app`.

## Detalhes técnicos

- `src/lib/meta/provider.server.ts`: `redirectUri` resolvido por origem permitida; fim do fallback para domínio inativo.
- `src/lib/meta/meta.functions.ts`: `startMetaOAuth` repassa a origem; `getActiveMetaSession` valida o token antes de reutilizar a sessão.
- `src/lib/meta/portfolio.functions.ts`: no `catch` da descriptografia, marcar a sessão como expirada e retornar um código de erro tipado (`META_SESSION_INVALID`) em vez de mensagem genérica.
- `src/components/**` (seletor de contas Meta): tratar `META_SESSION_INVALID` reiniciando o OAuth.
- Sem alterações de schema, RLS ou migrations. Linhas antigas de `meta_oauth_sessions` continuam no banco, apenas deixam de ser reutilizadas.

# Carrossel: publicação no Instagram e Facebook

## O que está acontecendo

O erro da tela ("Formato ainda não publicável (Feed IG/FB, Stories IG ou Reels IG)")
não vem da Meta: é o próprio Unitos barrando o formato antes de qualquer chamada.
A matriz de formatos publicáveis em `src/lib/scheduling-wizard.functions.ts:809`
aceita apenas `feed`, `stories` e `reels`; `carrossel` cai no bloqueio.

O banco já aceita `placement = 'carousel'` em `social_posts`, e o serviço da Meta
(`src/lib/meta/publishing.server.ts`) ainda não tem caminho de carrossel — o
comentário no topo do arquivo diz explicitamente que carrossel está fora de escopo.

Ou seja: falta implementar o formato, ponta a ponta.

## Como o carrossel será publicado

**Instagram (2 a 10 mídias)** — padrão da Graph API em três etapas: um container
por mídia com `is_carousel_item=true`, um container-pai `media_type=CAROUSEL` com
a lista de filhos e a legenda, e a publicação do pai. Vídeos entre os itens exigem
espera de processamento (a mesma espera que estamos aplicando a Stories/Reels).

**Facebook (2 ou mais fotos)** — publicação de fotos não publicadas
(`published=false`) e um post no feed com `attached_media`, que é como o Facebook
representa um álbum/carrossel. Vídeo no carrossel do Facebook fica fora de escopo
(mensagem clara em pt-BR).

## Regras do formato

- Mínimo 2 mídias, máximo 10 (Instagram). Menos de 2: mensagem em pt-BR pedindo
  mais mídias, sem chamar a Meta.
- A ordem dos itens é a ordem das mídias da peça.
- Legenda e hashtags vão no container-pai (não nos filhos).
- Um único registro em `social_posts` por destino, com `placement = 'carousel'`
  e a lista de mídias em `media`, respeitando o índice de destino ativo já
  existente.
- Vale para "publicar agora" e para o agendado (worker) — mesmo serviço.
- Pré-flight de autorização granular por conta continua obrigatório.

## Onde aparece

- Wizard de agendamento: carrossel deixa de ser bloqueado; validação de
  quantidade de mídias antes do envio.
- Prévia (`post-preview.tsx`) já desenha os pontos do carrossel — só passa a
  refletir a peça publicável.
- Calendário/Conteúdo: formato `carrossel` com os mesmos estados de fila,
  adiamento e reenvio dos outros formatos.

## Detalhes técnicos

- `src/lib/meta/publishing.server.ts`: novo placement `instagram_carousel` e
  `facebook_carousel`; criação de filhos, container-pai e publicação com a espera
  de processamento e o retry de `code 9007` já introduzidos nesta rodada.
- `src/lib/scheduling-wizard.functions.ts`: matriz de formatos aceita
  `carrossel` (IG e FB), assina todas as mídias da peça (não só a primeira),
  monta o array de mídias, grava 1 linha com `placement: 'carousel'`.
- `src/routes/api/public/meta/publish-scheduled.ts`: mapear `carousel` para o
  provider correspondente e validar a quantidade de mídias.
- `src/lib/meta/publish-capability.server.ts`, `publish-retry.functions.ts`,
  `calendar-board.functions.ts`: reconhecer a família `carousel` (readiness,
  reenvio, cancelamento e rótulos).
- Sem migration (o CHECK já permite `carousel`), sem mudança de RBAC/RLS/auth,
  sem publicação automática nova. Fuso `America/Sao_Paulo` preservado.
- Testes: carrossel IG cria filhos + pai e publica o pai; menos de 2 mídias é
  bloqueado com mensagem pt-BR; carrossel FB usa `attached_media`; vídeo no
  carrossel FB é recusado com mensagem clara.

## Em andamento nesta mesma rodada

A correção do Stories `Media ID is not available (code 9007)` já está aplicada
(espera de processamento antes de publicar, retry do 9007 e classificação como
erro transitório). O carrossel reutiliza exatamente essa espera.

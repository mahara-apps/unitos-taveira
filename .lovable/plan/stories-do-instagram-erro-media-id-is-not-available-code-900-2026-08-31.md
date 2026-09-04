# Stories do Instagram: erro "Media ID is not available (code 9007)"

## O que está acontecendo

No fluxo de Stories o sistema cria o container de mídia na Meta e, na linha
seguinte, já chama a publicação — sem esperar o processamento
(`src/lib/meta/publishing.server.ts`, `publishInstagramStory`). Para Reels isso
já é feito (`waitForContainerReady`), para Stories não.

Quando a Meta ainda não terminou de processar a mídia (típico em vídeo, e também
em imagem grande baixada da URL assinada), a publicação responde
`Media ID is not available (code 9007)` — exatamente a mensagem da tela. Não é
autorização, não é vínculo de conta, não é limite de requisições.

## Correção

1. **Esperar o container ficar pronto antes de publicar Stories**
   Reutilizar a espera já existente do Reels em `publishInstagramStory`:
   consultar `status_code` até `FINISHED`, com intervalo curto e timeout
   explícito; `ERROR`/`EXPIRED` viram mensagem em pt-BR. Aplicar a mesma espera
   ao Feed do Instagram quando a mídia for vídeo.

2. **Tolerar 9007 na publicação**
   Se `media_publish` ainda devolver `code 9007`, repetir a chamada algumas
   vezes com espera crescente antes de desistir. Persistindo, a mensagem passa a
   ser clara: "A Meta ainda está processando a mídia do Stories. Tentaremos
   novamente em instantes." — e o item volta para a fila em vez de queimar
   tentativa (mesmo tratamento já usado para limite de requisições).

3. **Não consultar permalink de Stories**
   Stories não expõem permalink; a consulta atual gera erro à toa (hoje
   silenciado). Remover a chamada nesse caminho para não poluir o log.

## Detalhes técnicos

- `src/lib/meta/publishing.server.ts`: `waitForContainerReady` passa a ser usada
  por Stories e por Feed IG com vídeo; retry específico para `code 9007` no
  `media_publish`; remoção do fetch de permalink em Stories.
- `src/lib/meta/rate-limit.ts`: classificar `9007` como transitório, para o
  worker adiar em vez de marcar falha definitiva.
- Vale para os dois caminhos: "publicar agora"
  (`src/lib/scheduling-wizard.functions.ts`) e agendado
  (`src/routes/api/public/meta/publish-scheduled.ts`) — ambos passam pelo mesmo
  serviço.
- Sem migration, sem mudança de RBAC/RLS/auth, sem publicação automática nova.
  Fuso `America/Sao_Paulo` preservado.
- Testes: Stories só publica após `FINISHED`; 9007 no publish é reclassificado
  como "tentar novamente" e não como falha final.

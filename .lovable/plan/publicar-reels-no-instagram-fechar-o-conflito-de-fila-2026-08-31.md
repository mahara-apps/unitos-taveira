# Publicar Reels no Instagram (+ fechar o conflito de fila)

## O que causou o erro que você viu

O erro "Falha em 1: instagram/reels — Formato ainda não publicável (Feed IG/FB ou Stories IG)" não é bug de conexão nem de mídia: **Reels simplesmente nunca foi implementado na publicação**. Hoje o sistema só publica:

- Instagram Feed (imagem/carrossel)
- Facebook Feed
- Instagram Stories

Qualquer outro formato cai no bloqueio explícito e é recusado antes de falar com a Meta. Isso vale tanto para "Publicar agora" quanto para o agendamento (o worker também só drena feed/story).

O segundo print ("duplicate key ... social_posts_active_dest_key") é o outro assunto que já está em andamento: reenvio de um destino que ainda tinha item pendente na fila. Essa parte já está quase concluída e será finalizada junto.

## Parte 1 — Reels no Instagram

1. Publicação Reels no serviço Meta: criar container com `media_type=REELS`, `video_url`, `caption` e `share_to_feed`, aguardar o processamento do vídeo (poll de `status_code` até `FINISHED`, com limite de tempo) e então publicar.
2. Validação de mídia antes de tentar: Reels exige exatamente 1 vídeo. Se a peça não tem vídeo (seus prints mostram "sem mídia"), o sistema recusa com mensagem clara em pt-BR ("Reels exige um vídeo…") em vez de erro técnico da Meta.
3. Liberar `instagram` + `reels` nos dois caminhos: "Publicar agora" e agendamento/fila, usando `placement = 'reel'` na fila (valor já permitido no banco, sem migration).
4. Worker de publicação agendada passa a tratar `reel` com o mesmo fluxo (claim, lock, backoff de rate limit já existentes).
5. Mensagens de erro por etapa (upload, processamento do vídeo, timeout, limite de requisições) traduzidas e reaproveitando a classificação de rate limit da Meta já implementada.
6. Formatos ainda não suportados (Facebook Reels, TikTok, LinkedIn etc.) continuam recusados, mas com mensagem que diz exatamente o que é suportado hoje.

## Parte 2 — Fechar o conflito de fila (já em andamento)

- Erro técnico `duplicate key … social_posts_active_dest_key` passa a aparecer como "Já existe uma publicação na fila para Instagram/Feed… aguardando nova tentativa".
- Destino que ficou na fila após erro temporário mostra o estado "Aguardando nova tentativa" com o horário previsto, em vez de parecer falha.
- Botão "Cancelar da fila" libera o destino para reagendamento imediato (nunca cancela item já em execução ou publicado).

## Detalhes técnicos

- `src/lib/meta/publishing.server.ts`: novo placement `instagram_reels`, método `publishInstagramReels` (container REELS → poll → publish), reuso do caminho de token descriptografado.
- `src/lib/scheduling-wizard.functions.ts`: matriz de formatos suportados inclui `instagram/reels`; mapeamento para `placement = 'reel'`; validação de vídeo antes do enfileiramento.
- Worker `/api/public/meta/publish-scheduled`: mapeia `reel` → `instagram_reels`.
- `src/lib/publish-retry.functions.ts` / painel de publicação: estado `awaiting_retry`, `nextAttemptAt`, `cancelQueuedPlacementFn` (já implementados nesta rodada).
- Sem migration: `social_posts.placement` já aceita `'reel'`.
- RBAC/RLS/auth, escopo por workspace/cliente e ausência de publicação automática preservados. Fuso `America/Sao_Paulo`.
- Testes: matriz de formatos suportados, validação de mídia de Reels, mapeamento de placement, conflito/cancelamento de fila. Depois typecheck e build.

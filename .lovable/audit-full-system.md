# Auditoria Sênior Ponta a Ponta — Read-only

Data: 2026-08-14 · Nenhum arquivo de aplicação alterado · Evidências: código + SQL de produção.

## 0. Veredito

O sistema tem **um pipeline canônico funcionando** (cliente → Brand Hub → volumetria → pauta → aprovação → materialização → tarefas), mas convive com **duas taxonomias de formato** e **um trecho legado ativo** de pauta. A cadeia de publicação (placements → social_posts → Meta → Kanban) está implementada e coerente, porém **nunca foi exercida em produção** (0 registros), logo é "correta por leitura", não "validada por dados".

Prioridades: P0 = taxonomia de formatos; P1 = legado `brand_pautas`; P1 = divergência da regra de "publicado" entre publicar-agora e cron; P2 = `post_placements.channel` guardado dentro de JSON.

## 1. Dados reais (produção, hoje)

| Métrica | Valor |
|---|---|
| clients | 8 |
| social_connections | 4 (0 com `client_id` legado preenchido) |
| client_social_accounts | 2 vínculos |
| posts | 32 (2 sem `project_id`, 0 sem `stage_id`) |
| posts com `stage_id.key <> stage` | **3** |
| post_placements | **0** |
| social_posts | **0** |
| monthly_plans | 3 approved · 3 archived · 1 draft |
| monthly_plan_topics | 66 |
| brand_pautas (legado) | **58** |
| tasks | 76 · posts com projeto sem tarefa: 0 |
| ai_jobs | monthly_plan 2 ok / 4 fail · post_phase2 18 ok / 1 fail · customer_strategy **0 ok / 11 fail** |
| ai_jobs travados (>30min running) | 0 |
| activity_events de passos de pauta | **0** |

Leituras:
- Materialização está íntegra: todo post com projeto tem tarefa; nenhum post órfão de stage.
- `customer_strategy` tem 100% de falha histórica — todas anteriores à correção de resiliência; não houve execução bem-sucedida **depois** da correção, então a correção segue **não confirmada empiricamente**.
- Observabilidade nova de pauta (`plan_step*`) tem 0 eventos: idem, código presente, caminho não exercido.

## 2. P0 — Duas taxonomias de formato coexistindo

Fonte de verdade declarada: `src/lib/content-formats.ts` (`feed`, `carrossel`, `reels`, `stories`, ...).

Realidade no banco:

- `monthly_plan_topics.content_format`: `Post estático` (27), `Carrossel` (10), `Storie` (12), `Reels` (12), `Vídeo curto` (5) — **0 linhas em chave canônica**.
- `posts.format`: `Post estático` (20), `Storie` (6), `Carrossel` (2), `Feed` (2), `Reels` (1), `Vídeo curto` (1).
- `post_placements.format` tem CHECK em minúsculas (`feed`/`reels`/`stories`/`carrossel`).

Mecânica do vazamento: `src/lib/monthly-plan-kanban.server.ts:180` copia `format: t.content_format` cru do tópico para o post. Sem normalização, o rótulo humano viaja até o post; quando esse post for para placement, o CHECK do banco rejeita (`Feed` ≠ `feed`). Reforçam o drift:
- `src/components/content/stage-colors.ts` — `normalizeFormat` devolve rótulos capitalizados ("Feed", "Storie").
- `src/components/calendar/schedule-wizard/index.tsx` — `"Feed" as PlacementFormat` (cast forçado, contorna o tipo).
- `sync_post_publication_state` compara `pp.format = 'stories'` para separar família story: qualquer valor não canônico cai no ramo "não-stories" silenciosamente.

Consequência prática: pauta gerada hoje materializa peças cujo formato **não é agendável** sem conversão, e a correspondência story↔feed na sincronização de publicação pode casar destino errado. É o único achado que quebra fluxo, não apenas estética.

Menor correção possível (não aplicada): normalizar na fronteira de escrita (materialização, wizard, placements) via `content-formats.ts`, manter um mapa `legacy → canônico` para leitura dos 58+32 registros antigos, e eliminar o `normalizeFormat` concorrente de `stage-colors.ts` reduzindo-o a rótulo de exibição.

## 3. P1 — Caminho legado de pauta ainda alcançável

`src/lib/ai-agents.functions.ts` mantém `pautaSuggestFn` e `sendPautaToContentFn`, que escrevem em `brand_pautas` (58 linhas) e criam peça sem passar por `monthly_plans → monthly_plan_topics → aprovação → materialização`. Efeitos: peças sem `monthly_plan_topic_id` (logo fora da idempotência da materialização), sem quota de volumetria, sem observabilidade e sem trilha de aprovação do cliente. A Fase 2A removeu os geradores de rota, mas não este par de server functions.

## 4. P1 — Regra de "publicado" divergente entre os dois caminhos

- **Cron** (`claim_scheduled_social_posts` + `sync_post_publication_state`): estrito e correto — só marca `posts.stage='published'` quando **nenhum** destino está `draft/scheduled/publishing` e nenhum placement pendente; casa placement por `connection_id` + família de formato; idempotente (nunca toca placement já publicado); `published_at` = max real.
- **Publicar agora** (wizard): marca a peça como publicada com `okCount > 0`, ou seja, **publicação parcial vira peça publicada**.

Mesma pergunta de negócio, duas respostas. O comportamento do cron é o correto; o caminho manual deveria delegar a `sync_post_publication_state` em vez de decidir por conta própria.

## 5. Isolamento cliente ↔ canal (correto)

Modelo N:N em `client_social_accounts` é respeitado de forma consistente nas três camadas:
- SQL: `claim_scheduled_social_posts` exige `sc.brand_id = sp.brand_id` **e** vínculo em `client_social_accounts`.
- Server: `resolver.server.ts` restringe candidatos aos IDs vinculados e devolve erro acionável ("Vincule em Perfil do cliente > Canais").
- UI: `scheduling-wizard.functions.ts` lista apenas conexões vinculadas e ativas.

`social_connections.client_id` está legado e **não é lido** por nenhum caminho — e 0 linhas o preenchem. Sem risco de vazamento entre clientes por esse eixo.

## 6. Volumetria → prompt → pauta (coerente)

`clients.brand_hub.volumetry_breakdown` é a fonte; `monthly-plan-context.server.ts` normaliza, resolve base semanal/mensal com `weeksPerMonth` real do mês, reconcilia diferença canal-vs-formatos e produz `monthlyQuota` + resumo textual para o prompt. `monthly-plan-distribution.ts` aloca slots. Sem caminho paralelo de volumetria. Único elo frágil é a saída da IA voltar em rótulo humano — ver P0.

## 7. Publicação Meta e IDs

`publishing.server.ts` usa corretamente `external_id` = Page ID e `account_id` = IG Business Account, exigindo `account_id` para caminhos Instagram. Webhook e deauthorize/data-deletion casam por `external_id`/`owner_external_id`. Consistente. Não validado em produção (0 `social_posts`).

## 8. Cron / Jobs (saudável)

13 jobs ativos, **todos** apontando para o host correto `project--3f33732a-…lovable.app`; cada URL tem rota correspondente em `src/routes/api/public/**` (media/prune, brain-consolidate, brain-synthesis, cron/sla-check, meta/publish-scheduled, social-metrics-sync, ai-models-health) e os jobs SQL puros existem como funções. Nenhuma duplicidade remanescente. Fase 1 confirmada.

## 9. Resiliência IA (implementada, não confirmada)

`customer-pipeline.ts` tem `maxRetries: 0` no SDK com retry próprio (backoff + `SPACING_MS`), classificação compartilhada em `ai-failures.server.ts`, persistência de `failed_step`/`completed_steps`/`failure_kind` e retomada idempotente via `replaceActive`. O padrão está correto e espelhado em `post-agents.server.ts`. Falta o sinal que importa: uma execução `customer_strategy` bem-sucedida.

## 10. P2 — Modelagem de placement

`post_placements` não tem coluna `channel`; o canal é gravado dentro de `copy_override.channel` (JSON) e relido por string em `scheduling-wizard.functions.ts`. Funciona, mas é dado estrutural em campo de conteúdo: impede índice/constraint e torna qualquer consulta por canal frágil. Baixo risco hoje (0 linhas) e o momento mais barato para corrigir é agora, antes do primeiro volume real.

## Ordem recomendada (se aprovada)

1. **P0** Normalizar formatos nas fronteiras de escrita + mapa de compatibilidade para os dados legados.
2. **P1** Remover/desativar `pautaSuggestFn` e `sendPautaToContentFn`; decidir destino das 58 linhas de `brand_pautas` (arquivar).
3. **P1** Fazer "publicar agora" delegar a `sync_post_publication_state` (fim da publicação parcial).
4. **P2** Promover `channel` a coluna de `post_placements`.
5. **Validação** Uma execução real de estratégia, uma pauta com eventos de observabilidade e uma publicação Meta ponta a ponta — sem isso, itens 5–9 permanecem "corretos por leitura".

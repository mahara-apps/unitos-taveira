# AUDITORIA ARQUITETURAL — BRAIN INTELLIGENCE 2.0 (READ-ONLY)

Data: 2026-08-17 · Nenhum código, migration, tabela, prompt, agente ou UI foi alterado.
Evidências: leitura de `src/lib/brain/**`, `BRAIN.md`, `DEPRECATION.md` + consultas de leitura em `brain_*`, `cron.job`, `cron.job_run_details`, `pg_trigger`.

---

## 1. ESTADO ATUAL DO BRAIN

Números reais (produção, hoje):

| Tabela | Linhas | Primeiro | Último |
|---|---|---|---|
| brain_events | 699 | 26/06 | 17/08 |
| brain_events_archive | 0 | — | — |
| brain_learning_queue | 710 (479 done · **231 queued**) | 17/07 | 17/08 |
| brain_memory | 188 | 17/07 | **13/08** |
| brain_memory_versions | 338 | 17/07 | 13/08 |
| brain_embeddings | 28 | 22/07 | 14/08 |
| brain_insights | **10** | 15/07 | **15/07** |
| brain_recommendations | **0** | — | — |
| brain_relationships | 347 | 17/07 | 13/08 |
| brain_metrics_snapshots | 503 | 15/07 | 13/08 |
| brain_reasoning_logs | 14 | 17/07 | 18/07 |
| brain_retention_config | 7 chaves | — | — |

### Três falhas críticas encontradas

**F1 — O Learning Worker está morto desde 13/08.**
`cron.job_run_details` do job 7 (`brain-learning-worker`, `* * * * *` → `process_brain_learning_queue(200)`): **4320 execuções, 100% `failed` com "job startup timeout"** nos últimos 3 dias. Consequência: 231 eventos presos em `queued` (mais antigo 13/08 19:07), `attempts = 0`, e nenhuma memória/relacionamento/snapshot novo desde 13/08. O Brain parou de aprender há 4 dias e nada na UI sinaliza isso.

**F2 — `brain.memory.list()` / `search()` / `remember()` consultam colunas que não existem.**
O schema real de `brain_memory` usa `key/title/description/category/scope/content`. O código seleciona `topic, summary` (e `remember()` insere `topic, summary, client_id, source_module`). Nenhuma dessas colunas existe → PostgREST devolve erro 400, e `list()` ignora o erro (`const { data } = await q`) retornando `[]`.
Impacto em cascata: **o Context Engine e o Chat Gateway nunca recebem memórias** (bucket "Memórias relevantes" sempre vazio), `brain.remember()` sempre falha e `getContext()` cai no `niche-fallback` genérico. É exatamente a "Fase 3" pendente no `DEPRECATION.md` — só que o efeito prático é que as 188 memórias existentes são invisíveis para os agentes.

**F3 — O que hoje se chama "aprendizado" é espelhamento de evento.**
`process_brain_learning_queue` cria 1 memória por evento com `category = event_type`, `key = event_type:entity:id`, `title = "content.updated • post"`, `description = "Padrão observado em post…"` e `confidence` fixa em 0,60/0,90/0,15 por `action`. Distribuição real confirma: 60 memórias `task.created`, 43 `content.created`, 33 `content.updated`… todas `conf 0.60`, `scope brand`. Só **3 memórias** têm semântica real de conhecimento (`approval_pattern`, `scope client`, conf 0,82). Ou seja: há *upsert por chave* (bom), mas o conteúdo não é conhecimento — é log com confiança sintética.

---

## 2. O QUE JÁ ESTÁ CORRETO (preservar)

1. **Fronteira arquitetural**: porta única `@/lib/brain/api`, ESLint bloqueando `.from("brain_*")` e imports legados fora de `src/lib/brain/**`. Excelente base — a Brain 2.0 não precisa de nova fachada.
2. **Event Bus fire-and-forget** com `waitUntil` + trigger SQL `trg_brain_events_enqueue_learning` em todas as partições: ingestão desacoplada e barata.
3. **Particionamento mensal** de `brain_events` + `brain_ensure_event_partitions(3,3)` + `brain_retention_run` diário: fundação de retenção pronta.
4. **Memória evolutiva já existe no banco**: `brain_memory` tem `key`, `version`, `confidence`, `previous_confidence`, `reinforcement_count`, `contradiction_count`, `decay_rate`, `access_count`, `status`, `expires_at`, `source_refs`, mais `brain_memory_evolve()`, `brain_memory_touch()`, `brain_memory_decay_and_archive()`, `consolidate_brain_memory()` e versionamento automático (`brain_memory_snapshot_trg` → 338 versões). **O modelo UPSERT+EVIDÊNCIA+CONFIANÇA que você descreveu já está implementado — só não está sendo usado com conteúdo semântico.**
5. **Context Engine escopado e determinístico**: `detectIntent` sem LLM, `MIN_SCORE 0.15`, `MAX_PER_BUCKET 6`, teto de 24 itens, cache de 30s. Direção correta de contexto compacto.
6. **Reasoning Engine v1** (intent→plan→tools→decision→response) com auditoria em `brain_reasoning_logs` e resposta determinística sem LLM quando possível.
7. **Fast-path de stats** via MV `brain_stats_mv` (refresh 5 min) e fallback com `head:true` — zero dump de linhas.
8. **Sync de métricas sociais** já roda como roll-up agregado (não linha-a-linha).

---

## 3. O QUE ESTÁ INCOMPLETO

| # | Lacuna | Evidência |
|---|---|---|
| 1 | Learning worker caído; sem observabilidade de falha | job 7: 4320 falhas |
| 2 | Memória invisível aos agentes | mismatch `topic/summary` vs schema |
| 3 | Aprendizado sem semântica (1 evento → 1 memória) | 188 memórias = espelho de eventos |
| 4 | Insight Engine parado desde 15/07 | 10 insights, cron 4 roda mas não produz (marcas sem chave / JSON) |
| 5 | Recommendation Engine nunca produziu nada | 0 linhas; só há `create()` manual |
| 6 | Nenhum evento `post.rework` existe → `runBrainSynthesis` (cron 15) roda todas as noites sobre conjunto vazio | distribuição de `event_type` |
| 7 | Sem camada GLOBAL/agência real | `brain_insights` e `brain_memory` só têm `brand_id`; `scope='global'` só ocorre se `brand_id IS NULL` |
| 8 | `brain_insights` **não tem `client_id`** (isolamento por `metadata->>client_id`, que ninguém preenche) | schema + `insights/index.ts` |
| 9 | `brain.learn()` insere `job_type`/`payload` em `brain_learning_queue`, que só tem `event_id` | schema real |
| 10 | `brain.learning.pending()` conta `status='pending'`; os estados reais são `queued`/`processing`/`done` → diagnóstico sempre 0 | código vs dados |
| 11 | Métricas reais de desempenho (engajamento, alcance, retenção) não entram no Brain — só contagem de publicações e `success_rate` | `social-metrics-sync.server.ts` |
| 12 | Zero benchmark; `brain_metrics_snapshots` guarda `events.<tipo> = 1` por evento (contador cru, não benchmark) | 503 linhas de valor 1 |

---

## 4. MAPA DE FONTES DE DADOS

**Alimentam o Brain hoje (triggers SQL):** `clients`, `posts`, `tasks`, `projects`, `task_comments`, `post_approvals`, `client_documents`.
**Alimentam via código:** `content.functions.ts` (ingestQuiet + registerEvent + learn), `client-journey.functions.ts`, `social-metrics-sync.server.ts` (roll-up diário).

**NÃO alimentam o Brain (gaps de alto valor):**
briefings (`brand_briefings`, `client_briefings`), personas, cohorts, SWOT, voice cards, competidores, `monthly_plans` + `monthly_plan_topics` (geração, aprovação interna, aprovação do cliente, ajustes), `post_placements`/`social_posts` (publicação real e falhas), `calendar_events`, `task_time_entries` (esforço real), `plan_overage_requests`, `ai_jobs`/`brand_ai_usage`/`ai_failures` (resultado e custo dos agentes), `card_approval_events`, `message_logs`, `client_journey_events` (parcial).

Observação: `client_id` só é preenchido nos eventos vindos de triggers de conteúdo/tarefa/cliente. Eventos de `portal`, `analytics`, `ai` e `editorial` chegam com `client_id = NULL` (24 + 8 + 8 + 8 + 8 + 8 + 4 linhas) — o que os torna "genéricos" e visíveis para **qualquer** cliente da marca no filtro do Context Engine.

---

## 5. MAPA DOS AGENTES

| Agente | Recebe Brain hoje | Produz evidência | Deveria receber |
|---|---|---|---|
| Chat / Copiloto | **Sim** (`buildContext` + `recordContextUsage`) | sim (provenance) | ok |
| Pauta Mensal (`monthly-plan-generate`) | **Sim** (`brain.getContext`) — mas markdown vem sem memórias (F2) | não registra resultado da pauta | estratégia, preferências, personas, desempenho, aprendizados, benchmark |
| Estratégia/Briefing (`ai-agents.functions`) | Parcial (`brain.insights.list`) | não | briefing consolidado + histórico de aprovação |
| Copywriter / `post-agents.server.ts` | **Não** | **Não** (não emite `post.rework`, nem sucesso/falha) | voz, reworks, padrões de aprovação, briefing da peça |
| Roteirista Social | **Não** | Não | padrões de Reels, retenção, formatos |
| Diretor de Arte | **Não** | Não | identidade visual, formatos, histórico de aprovação |
| Analista de métricas / dashboards | Não (lê social direto) | roll-up diário | benchmarks |
| Decisões humanas (aprovar, rejeitar, ajustar, reagendar, editar copy) | — | **parcialmente perdidas** | são a evidência mais valiosa e hoje quase não viram evento tipado |

---

## 6. MAPA DO LEARNING LOOP

```text
DADO ──✅──▶ EVENTO ──✅──▶ FILA ──❌ WORKER CAÍDO ──▶ MEMÓRIA(espelho) ──❌ INVISÍVEL ──▶ CONTEXTO
                                                                                          │ ✅ (chat/pauta)
                                                                                          ▼
                                        NOVA EVIDÊNCIA ◀──❌ RESULTADO ◀──❌ DECISÃO ◀── AGENTE
```
Elos rompidos, na ordem de gravidade: **(a)** worker caído; **(b)** memória não chega ao contexto; **(c)** agente→resultado→evidência inexistente (nenhum agente devolve nada ao Brain); **(d)** insight/recomendação sem produtor confiável.

---

## 7. RISCOS DE CRESCIMENTO DO BANCO

1. **`brain_metrics_snapshots` é o pior ofensor**: 1 linha por evento com `metric_value = 1`. Escala 1:1 com eventos e não é benchmark. Deveria ser agregação diária por (brand, canal, métrica).
2. **`brain_memory` cresce 1:1 com entidade×tipo de evento** (`key` inclui `entity_id`): 60 memórias só de `task.created`. Em 12 meses, dezenas de milhares de "memórias" sem densidade.
3. **`brain_memory_versions`**: 338 versões para 188 memórias, geradas por `BEFORE UPDATE` incondicional — toda batida em `access_count`/`last_accessed_at` pode virar versão.
4. **`brain_events_archive` vazio** com retenção rodando → confirmar que o TTL de 7 chaves cobre todos os `event_type` (eventos sem regra tendem a viver para sempre).
5. **`brain_learning_queue` nunca é podada** — 710 linhas com 479 `done` retidas.
6. **Payloads de evento sem limite de tamanho** (`content.updated` = 299 eventos, o tipo mais volumoso, provavelmente com diffs inteiros).

---

## 8. RISCOS DE CONTEXTO EXCESSIVO

- Hoje o risco real é o **oposto**: contexto pobre (memórias vazias, 0 recomendações, insights de 15/07 já expirados a 14 dias → `list()` filtra `expires_at` → provavelmente **nada** chega ao agente).
- Riscos latentes quando F1/F2 forem corrigidos: `memory.list(limit 20)` sem filtro por categoria/recência; bucket `stat` injetando toda chave numérica; `semantic()` devolvendo *resumo de evento cru* (não conhecimento); markdown do pack sem teto de caracteres/tokens; `brainMarkdown` concatenado ao prompt da pauta sem truncamento.
- Não existe **perfil de contexto por agente** — `buildContext` é genérico; copywriter, roteirista e diretor de arte precisariam de recortes distintos.

---

## 9. RISCOS DE ISOLAMENTO ENTRE CLIENTES

1. **`brain_insights` sem `client_id`**: o isolamento depende de `metadata->>client_id`, que nenhum produtor preenche. Logo, **todo insight de marca com múltiplos clientes é servido a todos os clientes** — inclusive os gerados por `brainConsolidateFn` a partir de eventos de um único cliente.
2. **`brain_memory` sem `client_id`** (só `metadata->>client_id`, também não preenchido pelo worker): mesmo vazamento intra-marca, hoje mascarado pela F2.
3. **Eventos com `client_id NULL`** (portal, analytics, ai, editorial) são tratados como genéricos e passam por qualquer filtro de cliente.
4. **`query.semantic()`** filtra por cliente *depois* do RPC (que só conhece `brand_id`), pedindo 4× candidatos — correto na intenção, mas admite `client_id IS NULL` como genérico (ver item 3).
5. **`brain_relationships`** não tem `client_id`; o grafo mistura entidades de clientes distintos dentro da marca.
6. Não há **nenhum mecanismo de anonimização** para conhecimento global — hoje "global" = `brand_id IS NULL`, o que significa "sem marca", não "agregado e anonimizado".

---

## 10. O QUE DEVE VIRAR MEMÓRIA (persistente, evolutiva, com `key` estável)

Nível **CLIENTE**: `preferencia_editorial`, `tom_de_voz`, `restricoes_de_conteudo`, `padrao_de_aprovacao` (tempo médio, taxa de ajuste), `formatos_preferidos`, `temas_sensiveis`.
Nível **MARCA**: `posicionamento`, `personas_ativas`, `pilares_de_conteudo`, `identidade_visual`, `formatos_que_performam`, `canais_prioritarios`.
Nível **OPERACIONAL**: `sla_real_de_aprovacao`, `custo_de_retrabalho_por_formato`, `capacidade_de_producao`, `atrasos_recorrentes`.
Regra: uma memória por (escopo, categoria) — não por entidade. `key = 'client:<id>:preferencia_editorial'`, e cada nova evidência chama `brain_memory_evolve` (reforça / enfraquece / contradiz).

## 11. O QUE DEVE VIRAR INSIGHT (expira ou é recalculado)

Padrões de desempenho por formato/canal em janela de 30–90 dias; anomalias (queda de engajamento, aumento de rework); tendências de tema; alertas operacionais; comparativo período-a-período. Sempre com `client_id` real, `expires_at` e `based_on_events`.

## 12. O QUE DEVE SER APENAS EVENTO (retenção curta, 30–90 dias)

Toda mudança de campo (`content.updated`, `task.updated`, `customer.updated`), transições de stage, visitas ao portal, criações, logs de execução de agente, cliques e sincronizações. Matéria-prima: é lido pelo learning e descartado. Payload deve ser diff enxuto (campos alterados), não registro inteiro.

## 13. O QUE DEVE SER AGREGADO GLOBALMENTE (anonimizado)

Desempenho por (segmento, formato, canal) com **k-anonimato mínimo (ex.: ≥5 marcas / ≥30 posts)**; tempo médio de aprovação por porte de cliente; taxa de rework por formato; sazonalidade por segmento. Armazenar como memória `scope='global'` com `brand_id NULL` e conteúdo apenas estatístico — nunca IDs, nomes, copies ou trechos de briefing.

## 14. O QUE DEVE SER DESCARTADO/EXPIRADO

Memórias-espelho de evento (`category = event_type`, conf fixa 0,60) — 185 das 188 atuais; `brain_metrics_snapshots` com `metric_value=1` (substituir por agregação diária); versões geradas por simples `touch`; embeddings de eventos triviais (update/created); itens `done` da fila com mais de 7 dias; insights expirados (hoje ficam na tabela).

---

## 15. COMO O BRAIN DEVE ALIMENTAR CADA AGENTE (perfis de contexto)

| Agente | Pacote (teto sugerido) |
|---|---|
| Pauta Mensal | estratégia da marca + 5 memórias de marca + 3 de cliente + 3 insights de desempenho + 1 benchmark global · ~1.500 tokens |
| Copywriter | voz + `preferencia_editorial` do cliente + 3 padrões de rework + padrão de aprovação + briefing da peça · ~800 tokens |
| Roteirista | padrões de Reels + retenção + formatos que performam + preferências · ~800 tokens |
| Diretor de Arte | identidade visual + formatos + histórico de aprovação visual · ~600 tokens |
| Chat | pack atual (já correto) com teto de caracteres |

Implementação sugerida: `brain.buildContext(ctx, { question, module, profile })` reaproveitando `assemble.ts` — apenas um mapa de perfis (categorias permitidas + limites), sem novo motor.

---

## 16. GAPS EXISTENTES (consolidado, priorizado)

P0 — worker de learning caído · memória invisível (`topic/summary`) · insights sem `client_id`.
P1 — nenhum agente devolve evidência ao Brain · `post.rework` inexistente · memórias-espelho sem semântica · `brain.learn()` incompatível com o schema da fila.
P2 — sem benchmarks/global anonimizado · `brain_metrics_snapshots` como contador cru · recomendações vazias · sem perfis de contexto por agente · sem poda de fila/versões · sem alerta de saúde do Brain na UI.

---

## 17. ARQUITETURA RECOMENDADA (evolução, não reconstrução)

Nenhuma tabela nova é necessária. Tudo cabe no schema atual:

```text
EVENTO (brain_events, TTL 30–90d, payload = diff)
   │  trigger → brain_learning_queue
   ▼
LEARNING (process_brain_learning_queue reescrito por REGRA)
   ├─ regras determinísticas por event_type → brain_memory_evolve(key por ESCOPO+CATEGORIA)
   ├─ rollup diário → brain_metrics_snapshots (agregado, não 1 por evento)
   └─ embedding SOMENTE p/ eventos textuais ricos (briefing, rework, feedback, copy aprovada)
   ▼
CONHECIMENTO
   ├─ brain_memory  scope: global | brand | client | operational   (evolutivo, decay, versões)
   ├─ brain_insights  + client_id real, expires_at, based_on_events
   └─ brain_relationships (grafo, + client_id)
   ▼
CONTEXTO (assemble.ts + PERFIL POR AGENTE, teto de tokens)
   ▼
AGENTE → DECISÃO → RESULTADO → registerEvent(outcome) → volta ao topo
```

Mudanças estruturais mínimas (para a fase de implementação, não agora): `client_id` em `brain_insights` e `brain_relationships`; `scope` de `brain_memory` passando a aceitar `client`/`operational` de fato; nada além disso.

---

## 18. PLANO DE IMPLEMENTAÇÃO INCREMENTAL (maior ganho / menor risco)

**Fase 0 — Reanimar (risco mínimo, ganho imediato)**
1. Corrigir o job `brain-learning-worker` ("job startup timeout" em 100% das execuções) e drenar os 231 itens presos.
2. Alinhar `memory/index.ts` e `chat-gateway/consolidate.ts` ao schema real (`key/title/description/category`) — destrava as 188 memórias e o Context Engine. Nenhuma migration.
3. Corrigir `brain.learn()` e `learning.pending()` (`queued`, não `pending`) + expor saúde do Brain em `/brain/diagnostics`.

**Fase 1 — Isolamento (segurança primeiro)**
4. Adicionar `client_id` a `brain_insights` (e `brain_relationships`), backfill via `source_refs`/evento, e passar a filtrar por coluna em vez de `metadata`.
5. Garantir `client_id` nos eventos de portal/analytics/ai/editorial.

**Fase 2 — Aprendizado real (o coração)**
6. Reescrever o learning por **regras determinísticas por `event_type`**, com `key` por ESCOPO+CATEGORIA (não por entidade): aprovação → `padrao_de_aprovacao`; ajuste → `preferencia_editorial`; publicação+métrica → `formatos_que_performam`.
7. Emitir os eventos que faltam: `post.rework`, `plan.approved/rejected/adjusted`, `agent.output`, `agent.failure`, `publication.result` — a partir dos módulos existentes (Pauta, post-agents, aprovações).
8. Poda: memórias-espelho legadas, fila `done` > 7d, versões triviais.

**Fase 3 — Densidade e agregação**
9. `brain_metrics_snapshots` como roll-up diário real (engajamento/alcance por formato e canal), consumindo Meta insights já cacheados.
10. Benchmarks globais anonimizados com k-anonimato (memória `scope='global'`).
11. Política de embeddings: só texto rico; compactar/expirar embeddings de eventos triviais.

**Fase 4 — Contexto por agente e loop fechado**
12. Perfis de contexto (`profile`) para copywriter, roteirista, diretor de arte e pauta, com teto de tokens.
13. `recordContextUsage` + `outcome_score` em todos os agentes → evidência de volta ao Brain (loop completo).
14. Recommendation Engine alimentado por insights (next-best-action) — primeira entrega útil das 0 linhas atuais.

Cada fase é independente e reversível; a Fase 0 sozinha já restaura o Brain a um estado funcional.

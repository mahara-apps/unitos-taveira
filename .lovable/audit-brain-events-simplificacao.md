# Auditoria READ-ONLY — Arquitetura `brain_events` (simplificação)

Data: 2026-08-29 · Nenhuma alteração executada (sem DDL, DML ou migration).

## 1. Volume real (evidência de banco)

| Objeto | Linhas est. | Heap | Índices | Nº índices |
|---|---|---|---|---|
| `brain_events` (parent) | — | 0 | 0 | 8 (templates) |
| `brain_events_202605` | 0 | 0 | 104 kB | 8 |
| `brain_events_202606` | 10 | 8 kB | 160 kB | 8 |
| `brain_events_202607` | 287 | 104 kB | 200 kB | 8 |
| `brain_events_202608` | 3.115 | 832 kB | 808 kB | 8 |
| `brain_events_202609/10/11` | 0 | 0 | 104 kB cada | 8 cada |
| `brain_events_default` | 0 | 0 | 104 kB | 8 |
| `brain_events_archive` | 0 | 0 | 64 kB | 3 |

- Total de eventos: **3.430**, janela `2026-06-26 → 2026-08-29`, 539 marcas distintas (a maioria marcas efêmeras de testes).
- Eventos com mais de 90 dias: **0** → o job de arquivamento nunca teve trabalho real.
- Índices ocupam mais espaço que os dados (≈1,7 MB de índice vs ≈0,95 MB de heap).

Conclusão de escala: o volume é de **milhares** de linhas, não de milhões. Particionamento mensal só se justifica a partir de dezenas de milhões de linhas ou de necessidade de `DROP PARTITION` para expurgo massivo — nada disso ocorre aqui.

## 2. Índices por uso (`pg_stat_user_indexes`)

Em todas as partições, apenas 3 índices têm scans relevantes:
- `*_pkey` (usado massivamente — inclui o lookup por `id` do worker/embeddings)
- `*_brand_id_created_at_idx` (leitura escopada por workspace — padrão dominante do código)
- `*_event_type_idx` (poucas dezenas de scans, usado em diagnósticos/síntese)

Com **0 scans em todas as partições**:
- `*_entity_type_entity_id_idx`
- `*_source_module_idx` (apenas 5 scans em 202608, resto 0)
- `*_actor_id_idx` (3–6 scans esporádicos)
- `*_created_at_idx` **e** `*_created_at_idx1` — **duplicidade real**: dois índices sobre `created_at` (um BTREE, um BRIN), ambos praticamente sem uso, redundantes com `(brand_id, created_at)`.

`brain_events_archive`: `pkey` com 4 scans (catálogo), `brand_created_idx` e `created_brin` com **0 scans**, tabela vazia.

## 3. Dependências

**FKs existentes:** apenas `brand_id → brands` (replicada em cada partição). Nada aponta para `brain_events`.

**FKs ausentes por causa do particionamento** (uma tabela particionada não pode ser destino de FK sem incluir a chave de partição):
- `brain_learning_queue.event_id` → sem FK. **Consequência medida: 132 linhas órfãs na fila neste momento** (`event_id` inexistente), o mesmo problema já corrigido em nível de worker/reaper mas que continua se reproduzindo por falta de integridade referencial.
- `brain_embeddings.event_id` → sem FK (hoje 0 órfãos, mas sem garantia estrutural).

**Triggers (replicados em parent + 8 partições = 18 triggers):**
- `trg_brain_events_guard_identity` → `brain_events_guard_identity()` (segurança de identidade/ator) — essencial.
- `trg_brain_events_enqueue_learning` → `enqueue_brain_event_for_learning()` (alimenta a fila) — essencial.

**Funções de particionamento:** `brain_ensure_event_partitions()`, `brain_apply_partition_policies()`, `brain_archive_and_prune_events()`, `_brain_cfg_days()`, `brain_retention_run()`.

**RLS:** `brain_events_part_select` / `brain_events_part_insert` replicadas em parent + todas as partições (18 policies para 2 regras lógicas). `brain_events_archive` tem policy própria de SELECT por escopo.

**Realtime:** `brain_events` **não** está na publicação `supabase_realtime` (só `brain_insights`, entre as tabelas Brain). O hook `use-brain-stream.tsx` assina `postgres_changes` em `brain_events` — hoje sem efeito prático, e uma tabela particionada não emite eventos de replicação pelo nome do parent, apenas pela partição. Isso é uma quebra silenciosa causada pelo particionamento.

**Crons relacionados:** `brain-learning-worker` (1 min), `brain-learning-reaper` (5 min), `brain-retention` (03:15), `brain-consolidate`, `brain-pattern-mining`, `brain-synthesis`, `brain-social-metrics-sync`, `refresh-brain-stats-mv`. A MV `brain_stats_mv` **não referencia** `brain_events` (só `posts`, `tasks`, `projects`, `brands`).

**Código que toca `brain_events`** (sempre pelo nome do parent, nunca por partição):
grava — `event-bus/index.ts`, `ingest-quiet.server.ts`, `social-metrics-sync.server.ts`;
lê — `overview.server.ts`, `diagnostics.functions.ts`, `learning/synthesize.server.ts`, `legacy/brain-consolidate.functions.ts`, `legacy/brain-intelligence.functions.ts`, `query/index.ts` (RPC `match_brain_events`), `stream/use-brain-stream.tsx`.
**Nenhuma linha de código referencia uma partição, o default ou o archive.**

## 4. Respostas diretas

1. **Particionamento mensal se justifica?** Não. 3.430 linhas, 0 eventos com >90 dias, nenhuma query por partição, e o custo é real: 18 triggers, 18 policies, 64 índices, funções de manutenção e perda de FK/realtime.
2. **`brain_events` pode virar tabela única com PK `id`?** Sim. A PK atual já é composta por exigência de particionamento; todo o código usa `id` como chave lógica (`event_id` na fila/embeddings). Tabela única com `PRIMARY KEY (id)` é estritamente mais capaz.
3. **`brain_events_archive` é necessária?** Não. 0 linhas, 0 scans nos índices de negócio, nenhuma leitura em código, e nenhum evento atingiu a idade de arquivamento.
4. **Índices removíveis:** `entity_type_entity_id`, `source_module`, `actor_id`, e a duplicidade `created_at` + `created_at BRIN`. Manter `pkey`, `(brand_id, created_at DESC)` e `event_type`.
5. **Functions/triggers de particionamento que desaparecem:** `brain_ensure_event_partitions`, `brain_apply_partition_policies`, `brain_archive_and_prune_events`. Mantêm-se `brain_events_guard_identity`, `enqueue_brain_event_for_learning`, `brain_cleanup_ttl`, `brain_retention_run` (reduzida).
6. **FKs que passariam a existir:** `brain_learning_queue.event_id → brain_events(id) ON DELETE CASCADE` e `brain_embeddings.event_id → brain_events(id) ON DELETE CASCADE` — eliminam a classe de órfãos na raiz.
7. **Impacto em Learning/Embeddings/Memory/Insights/Recommendations/Relationships:** nenhum funcional. Nenhuma dessas tabelas tem FK para `brain_events`; o acoplamento é apenas `event_id` lógico, preservado. Learning ganha integridade; as demais são indiferentes.
8. **Realtime:** melhora. `brain_events` como tabela normal pode ser adicionada à publicação e o `useBrainStream` passa a funcionar de fato. Hoje é inerte.
9. **Crons de retenção:** `brain-retention` fica só com TTL por idade (`DELETE` simples) e limpeza de fila; deixa de criar partições e de arquivar. `brain-learning-worker`/`reaper` inalterados.
10. **Riscos de migração:**
    - Downtime de escrita curto na troca de nome da tabela (mitigável com `swap` transacional).
    - `types.ts` é regenerado: as entradas de partição/archive desaparecem — recompilação obrigatória.
    - RPCs `match_brain_events` e `emit_brain_event` precisam continuar apontando para a nova tabela (mesmo nome ⇒ sem mudança de assinatura).
    - Ativar as FKs exige limpar os 132 órfãos atuais da fila antes, senão a criação falha.
    - Perda do caminho de arquivamento — aceitável porque está vazio, mas é decisão explícita de produto (histórico >90 dias passa a ser expurgado, não arquivado).

## 5. Classificação por objeto

| Objeto | Classificação | Justificativa |
|---|---|---|
| `brain_events` (particionada) | **MIGRAR** → tabela única, `PK (id)` | volume baixo; nenhuma query por partição |
| `brain_events_202605…202611` | **REMOVER** (após merge dos dados) | só 202606–202608 têm dados; nenhuma referência em código |
| `brain_events_default` | **REMOVER** | vazia; existe apenas por exigência do particionamento |
| `brain_events_archive` | **REMOVER** | 0 linhas, 0 leituras, nenhum consumidor |
| Índices `pkey`, `(brand_id, created_at)`, `event_type` | **MANTER** | únicos com scans relevantes |
| Índices `entity_*`, `source_module`, `actor_id`, `created_at` ×2 | **REMOVER** | 0–6 scans; duplicidade BTREE/BRIN em `created_at` |
| `brain_ensure_event_partitions` | **REMOVER** | sem função após desparticionar |
| `brain_apply_partition_policies` | **REMOVER** | idem |
| `brain_archive_and_prune_events` | **REMOVER** | archive descontinuado |
| `brain_retention_run` / `brain_cleanup_ttl` | **SIMPLIFICAR** | manter TTL por idade e limpeza de fila |
| `brain_events_guard_identity` (trigger) | **MANTER** (1 trigger em vez de 9) | controle de identidade do ator |
| `enqueue_brain_event_for_learning` (trigger) | **MANTER** (1 em vez de 9) | alimenta o Learning |
| Policies `brain_events_part_select/insert` | **SIMPLIFICAR** | 2 policies no lugar de 18 |
| `emit_brain_event`, `match_brain_events` | **MANTER** | contrato público inalterado |
| `brain_learning_queue` | **MANTER + FK** | ganha `event_id → brain_events(id) CASCADE` |
| `brain_embeddings` | **MANTER + FK** | idem; remover `event_idx`/`created_brin` sem uso |
| `brain_memory` / `_versions` | **MANTER** (revisar índices) | 15 índices para 196 linhas; vários com 0 scans |
| `brain_insights` | **MANTER** | em uso, inclusive realtime |
| `brain_recommendations` | **MANTER** | em uso |
| `brain_relationships` | **MANTER** (revisar índices) | 9 índices para 347 linhas |
| `brain_retention_config` | **SIMPLIFICAR** | remover chaves `brain_events_archive_days`, `brain_events_hot_days` |
| `brain_worker_runs` | **SIMPLIFICAR** | 17.747 linhas / 8,9 MB — a maior tabela Brain, sem TTL próprio |
| `brain_stats_mv` | **MANTER** | independe de `brain_events` |
| Realtime `brain_events` | **MIGRAR** | adicionar à publicação após desparticionar, para o `useBrainStream` funcionar |

## 6. Arquitetura final proposta

```text
brain_events (tabela única, PK id, created_at indexado via brand_id+created_at)
  ├─ trigger guard_identity          (1)
  ├─ trigger enqueue_learning        (1)
  ├─ policies select/insert          (2)
  ├─ índices: pkey, (brand_id, created_at DESC), (event_type)
  ├─ FK brand_id → brands
  ├─ realtime: na publicação supabase_realtime
  ├─ brain_learning_queue.event_id  → FK CASCADE
  └─ brain_embeddings.event_id      → FK CASCADE

retenção: brain_retention_run() = DELETE por idade + TTL de fila + TTL de worker_runs
removido: partições, default, archive, funções de particionamento/arquivamento
```

## 7. Plano de migração proposto (não executado)

1. **Etapa 0 — pré-checagem:** confirmar 0 eventos >90 dias, contar órfãos da fila, snapshot de contagens por tabela.
2. **Etapa 1 — poda de índices** (baixo risco, reversível): remover em cada partição os índices com 0 scans e a duplicidade `created_at`. Validar que o Brain segue operando.
3. **Etapa 2 — descontinuar o archive:** remover `brain_archive_and_prune_events`, a chave `brain_events_archive_days` e a tabela `brain_events_archive` (vazia).
4. **Etapa 3 — desparticionar:** criar `brain_events_new` (tabela normal, `PK (id)`, 3 índices, FK para `brands`, 2 triggers, 2 policies, grants), copiar as ~3.430 linhas, e trocar os nomes em uma única transação; dropar o parent particionado e as partições.
5. **Etapa 4 — integridade:** limpar órfãos remanescentes da fila e criar as duas FKs `event_id … ON DELETE CASCADE`.
6. **Etapa 5 — limpeza de manutenção:** remover as funções de particionamento, simplificar `brain_retention_run`/`brain_cleanup_ttl`, adicionar TTL para `brain_worker_runs`.
7. **Etapa 6 — realtime:** adicionar `brain_events` à publicação e validar `useBrainStream`.
8. **Etapa 7 — validação:** regenerar `types.ts`, rodar typecheck/testes/build, conferir Diagnósticos do Brain (worker saudável, fila processando, memórias/insights sendo criados) e o Overview.

Rollback: cada etapa é independente; a etapa 3 é a única com janela de escrita e deve manter a tabela antiga renomeada (`brain_events_old`) por alguns dias antes do drop definitivo.

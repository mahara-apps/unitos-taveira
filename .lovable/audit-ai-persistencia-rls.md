# Auditoria — Banco, persistência, RLS e isolamento das funcionalidades de IA (READ-ONLY)

Escopo: MASTER (Supabase `tkjbhttylouamqxnbfgv`). Nenhum arquivo de aplicação, migração ou dado de produção foi alterado. Evidências: `pg_policy`/`pg_class.relacl`, contagens reais, execução de `tests/rbac-scope`, `scope-closure`, `storage-scope` (57 PASS / 4 skip) e sonda autenticada por papel (OWNER/ADMIN, MANAGER sem cliente, USER do cliente A, PORTAL, membro de outro workspace, ANON) com linhas semeadas e removidas no teardown.

## 1. Tabelas de IA, chaves e vínculos

| Tabela | brand_id | client_id | user/actor | FKs | Linhas |
|---|---|---|---|---|---|
| ai_jobs | NOT NULL (FK brands, cascade) | nullable (FK clients) | user_id NOT NULL (sem FK auth.users) | 2 | 42 |
| brand_ai_usage | NOT NULL | nullable | actor_id (FK auth.users) | 3 | 270 |
| brand_ai_content / brand_ai_versions | sim | sim | created_by/changed_by | 5 / 3 | 0 / 0 |
| brain_memory | NOT NULL | nullable | — | 2 | 197 |
| brain_insights | NOT NULL | nullable | — | 2 | 22 |
| brain_embeddings | sim | — (herda de brain_events) | — | 2 | 80 |
| brain_learning_queue | sim | — | — | 1 (event_id) | 3.631 |
| brain_reasoning_logs | sim | sim | user_id | **0 FKs** | 15 |
| chat_conversations / chat_messages | sim | nullable | user_id | 3 / 2 | 3 / 46 |
| client_documents | sim | sim | — | 2 | 7 |
| briefing_import_runs / steps / changes | sim | sim | created_by | 6 / 3 / 3 | 12 / 33 / 45 |
| brand_media_assets | sim | nullable | — | 2 | 14 |
| agent_prompts (global) / agent_prompt_overrides (por marca) | — / sim | — | — | 0 / 2 | 9 / 1 |

## 2. Resultados por item

| Item | Resultado | Evidência |
|---|---|---|
| Registros de IA gravam brand_id/client_id/user_id | PASS | ai_jobs: 0 sem client_id, 0 órfãos de marca; briefing runs/steps/changes 100% com par marca+cliente |
| Relacionamentos e FKs | RISCO | `brain_reasoning_logs` não tem nenhuma FK (brand/client/user/conversation soltos) → 14 linhas sem brand_id e 1 apontando para conversa inexistente; `brain_learning_queue` sem FK de marca |
| Consistência marca↔cliente | PASS | `client_documents`, `briefing_import_runs` — 0 divergências entre `clients.brand_id` e a coluna `brand_id` |
| Duplicidades | PASS | `brain_memory` sem duplicatas por (brand, client, key) |
| Jobs/documentos presos | PASS | 0 `ai_jobs` em `running` >30min; 0 documentos em `queued/running` >1h; fila de aprendizado sem pendências |
| RLS habilitada em todas as tabelas de IA | PASS | `relrowsecurity = true` nas 24 tabelas verificadas |
| Acesso anônimo (Data API) | PASS | ANON recebe 42501 em todas as tabelas de IA; nenhum `SELECT/INSERT` concedido a `anon` |
| Isolamento entre workspaces | PASS | membro de outra marca: 0 linhas em todas as tabelas; escrita cross-brand negada (42501) |
| Isolamento entre clientes (documentos/jobs/chat) | PASS | doc do cliente B visível só ao ADMIN do workspace; MANAGER sem vínculo, USER do cliente A e PORTAL veem 0 |
| Portal isolado do backstage de IA | PASS | PORTAL: 0 em ai_jobs, brain_memory, brand_ai_usage, client_documents |
| Escrita de uso/telemetria pelo cliente | PASS | `brand_ai_usage` e `ai_jobs` de outra marca negados (42501); só service_role grava telemetria |
| Prompts de agentes protegidos | PASS | `agent_prompts` legível/gravável só por super admin (42501 para ADMIN e demais) |
| Storage policies dos arquivos de IA | PASS | buckets `brand-documents/brand-assets/brand-media` privados, com `storage_scope_allows` por caminho marca/cliente; `chat-attachments` e `avatars` por dono |
| Resultado da IA persistido e recuperável | PASS | `client_documents.ai_summary`, `briefing_import_*`, `brain_memory`, `chat_messages` persistem e são relidos pelas policies do mesmo escopo |
| **Memória e uso em nível de marca (client_id NULL)** | **FAIL de isolamento** | `client_in_scope(NULL, brand)` só exige membership: MANAGER sem cliente atribuído e USER do cliente A leram a memória brand-level (1/1) e o registro de uso brand-level (1/1). Em produção são **189 de 197** `brain_memory` e **210 de 270** `brand_ai_usage` sem `client_id`, com categorias derivadas de clientes (`client_feedback`, `customer.created/updated`, `post_approved`, `client.journey.changed`) — conteúdo de clientes não atribuídos fica legível por qualquer membro do workspace. `brain_insights` tem o mesmo padrão (22/22 sem cliente) e ainda libera `brand_id IS NULL` para qualquer autenticado |
| Tabelas de IA com RLS e nenhuma policy | RISCO | `brain_embeddings` (80) e `brain_learning_queue` (3.631) são deny-all no Data API (linter INFO 0008): seguro, mas nenhum papel — nem super admin — inspeciona pelo app; só service_role |
| Grants residuais para `anon` | RISCO | `briefing_import_runs/steps/changes` têm `TRUNCATE` (e `REFERENCES/TRIGGER`) concedido a `anon`; TRUNCATE não é filtrado por RLS. Sem `SELECT/INSERT`, a exposição via PostgREST é nula, mas o grant é indevido |
| Rastreabilidade de autoria no uso de IA | RISCO | 207 de 270 linhas de `brand_ai_usage` sem `actor_id` (execuções de worker/cron) — custo por usuário não auditável |
| Linter Supabase | RISCO | 87 achados: 4 RLS-sem-policy (acima), 21 funções SECURITY DEFINER executáveis por `anon`, 59 por autenticados, 2 extensões em `public`, proteção de senha vazada desativada |

## 3. Correções recomendadas (fora do escopo desta auditoria)

1. Trocar `client_in_scope(client_id, brand_id)` por um predicado que, quando `client_id IS NULL`, exija papel de workspace (`owner/admin`) — ou passar a gravar `client_id` sempre que a memória/uso derivar de um cliente. Vale para `brain_memory`, `brain_insights`, `brand_ai_usage` e `brain_metrics_snapshots`.
2. Remover o `brand_id IS NULL OR ...` de `brain_insights select in client scope`.
3. Adicionar FKs em `brain_reasoning_logs` (brand/client/conversation) e limpar as 15 linhas inconsistentes; FK de marca em `brain_learning_queue`.
4. `REVOKE ALL ON public.briefing_import_runs/steps/changes FROM anon`.
5. Criar policy explícita de leitura para super admin em `brain_embeddings` e `brain_learning_queue`, ou documentar que são service-role-only.
6. Preencher `actor_id`/`client_id` nas execuções de worker de IA.

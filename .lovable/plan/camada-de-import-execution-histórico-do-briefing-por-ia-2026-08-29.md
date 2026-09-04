# Camada de Import-Execution / Histórico do Briefing por IA

## Objetivo desta etapa

Criar a camada de **execução de importação** que hoje não existe: um registro durável de cada tentativa de "trazer conhecimento externo para o briefing", com etapas, proposta estruturada de mudanças, revisão, aplicação e histórico auditável. Nada de UI nova nesta etapa — o `window.prompt` só será substituído depois, sobre esta base.

## Estado atual verificado

- `ai_jobs` já é a tabela canônica de execução assíncrona (status, progress, step_label, input, result, error, brand/client/user). Não existem `ai_job_steps` nem `ai_artifacts` — as etapas hoje são só um rótulo em `ai_jobs.step_label` e um checkpoint em `ai_jobs.result`.
- `POST /api/jobs/analyze-document` faz uma chamada multimodal por arquivo e grava `client_documents.ai_summary / ai_status / analyzed_at / applied_to_briefing_at`. Sem execução registrada, sem retry, sem trava (o update para `running` não é condicional).
- `POST /api/jobs/customer-pipeline` é o pipeline de 5 etapas, já com `ai_jobs`, retry/backoff e checkpoint.
- `writeCanonicalBriefing()` (src/lib/briefing-write.server.ts) é a única porta de escrita do briefing: mescla em `clients.brand_hub` e cria snapshot em `brand_briefing_versions` (origin, changed_fields, completion).
- `brand_briefing_proposals` já existe, mas é acoplada ao portal (`request_id` obrigatório) — não serve para propostas geradas por IA.
- Brain (`brain_events`) não recebe nada do briefing além de triggers genéricos.

## Entidades propostas (3 tabelas novas, nenhuma removida)

### 1. `briefing_import_runs` — a execução
Uma linha por tentativa de importação. Reaproveita `ai_jobs` como job visível ao usuário (dock de gerações) via `ai_job_id`; a run guarda a semântica de briefing.

Campos de domínio: `brand_id`, `client_id`, `ai_job_id`, `created_by`, `source_kind` (`document` | `paste` | `transcript` | `url`), `document_id` (FK `client_documents`, nullable), `raw_text` (para colar/transcrição), `status`, `current_step`, `attempt`, `idempotency_key`, `model`, `provider`, `input_fingerprint`, `base_version_id` (FK `brand_briefing_versions`), `applied_version_id`, `summary`, `counts` (jsonb: created/updated/kept/discarded), `confidence`, `error`, `error_kind`, `tokens_in`, `tokens_out`, `cost_cents`, `started_at`, `finished_at`.

Estados: `queued → running → proposed → applying → applied` e terminais `failed` / `cancelled` / `discarded`. `proposed` é o estado em que a revisão humana acontece.

### 2. `briefing_import_steps` — as etapas
Substitui o `step_label` de string única por etapas persistidas e reexecutáveis: `run_id`, `step` (`ingest` | `extract` | `interpret` | `diff` | `propose` | `apply`), `status`, `attempt`, `input_ref`, `output` (jsonb), `error`, `error_kind`, `duration_ms`, `started_at`, `finished_at`. Único por (`run_id`, `step`) — o retry atualiza a linha e incrementa `attempt`.

Isso dá o retry seguro por etapa: um `apply` que falhou não re-executa a chamada de IA.

### 3. `briefing_import_changes` — a proposta, campo a campo
Uma linha por campo do briefing proposto: `run_id`, `field`, `action` (`create` | `update` | `keep` | `discard`), `current_value`, `proposed_value`, `confidence`, `evidence` (jsonb: trecho de origem, página/offset, e depois `speaker`), `decision` (`pending` | `accepted` | `rejected`), `decided_by`, `decided_at`.

É daqui que saem as contagens created/updated/kept/discarded (derivadas, não digitadas) e as evidências por mudança. A aplicação envia para `writeCanonicalBriefing` apenas os campos `accepted`.

### Transcrições (preparado, não implementado)
`source_kind = 'transcript'` + `briefing_import_runs.speakers` (jsonb, default `[]`) + `evidence.speaker_id` nas mudanças. Nesta etapa só reservamos o formato; a inteligência de identificar participantes/papéis vem depois, sem mudança de schema.

## Segurança

- Sempre `brand_id` + `client_id` nas 3 tabelas, RLS espelhando exatamente as policies de `client_documents` (`can_access_client`), com `GRANT` explícito para `authenticated` e `service_role`; sem `anon`.
- `briefing_import_steps` e `briefing_import_changes` também carregam `brand_id`/`client_id` (denormalizado) para que a policy não dependa de join, igual ao padrão já usado no projeto.
- Nenhuma alteração em RBAC, `app_access_role`, autenticação ou nas policies existentes.

## Idempotência e retry

- `idempotency_key` único por (`brand_id`, `client_id`, `source_kind`, `input_fingerprint`) enquanto a run estiver em estado não-terminal → clicar duas vezes devolve a mesma run em vez de criar outra.
- `input_fingerprint` = hash do conteúdo (storage_path + size + mtime para documento; sha256 do texto para colar/transcrição). Uma reanálise idêntica reutiliza a última run `proposed`/`applied` e não gasta IA de novo, salvo `force: true`.
- Transição para `running` sempre condicional (`.eq('status','queued')`), fechando a corrida que hoje existe em `analyze-document`.
- `apply` é idempotente por `applied_version_id`: se já existe, a aplicação retorna a versão existente.
- Runs travadas são recuperadas pelo padrão já existente (`reap_stuck_ai_jobs`), estendido para marcar a run correspondente como `failed` com `error_kind = 'stuck'`.

## Pontos de integração no código

- `src/lib/briefing-import.server.ts` (novo): criação de run, avanço de etapa, gravação de proposta, decisão e aplicação. Única porta de escrita das 3 tabelas.
- `src/lib/briefing-import.functions.ts` (novo): server fns com `requireSupabaseAuth` — `startBriefingImport`, `getBriefingImportRun`, `listBriefingImportRuns`, `decideBriefingImportChanges`, `applyBriefingImportRun`, `retryBriefingImportRun`.
- `src/routes/api/jobs/analyze-document.ts`: passa a abrir/avançar uma run em vez de escrever direto em `client_documents.ai_summary`; continua gravando os campos de compatibilidade do documento, e grava o **modelo real** (hoje está hardcoded como `google/gemini-2.5-flash`).
- `src/lib/documents-ai.functions.ts`: `applyDocumentToBriefing` passa a delegar para `applyBriefingImportRun`, mantendo a assinatura atual para não quebrar a UI existente.
- `writeCanonicalBriefing`: sem mudança de contrato; ganha `origin: 'ai.import'` e devolve o `versionId` que a run guarda em `applied_version_id`.
- Brain: no fechamento da run, um `emit_brain_event` com o resumo da importação (best-effort, nunca bloqueante) — fecha a desconexão entre briefing e Brain sem criar pipeline novo.

## Ordem segura de implementação

1. Migration das 3 tabelas + índices + GRANTs + RLS + trigger de `updated_at`.
2. `briefing-import.server.ts` com máquina de estados e helpers de idempotência (+ testes unitários da máquina de estados e do fingerprint).
3. Server fns (`briefing-import.functions.ts`) com escopo/RBAC, sem tocar UI.
4. Reescrita interna de `analyze-document.ts` para usar a run (comportamento externo e UI atual preservados).
5. `applyDocumentToBriefing` delegando para a run; contagens e vínculo documento→execução→versão passam a existir de verdade.
6. Evento de Brain no fechamento + testes de integração (isolamento por brand/client, idempotência, retry de `apply`).
7. Somente depois, em etapa própria: nova UI de importação (upload/colar/transcrição) substituindo o `window.prompt`.

## Fora do escopo desta etapa

Nova UI de importação, extração/OCR próprio, chunking, identificação de participantes de transcrição, unificação do pipeline de 5 etapas, migração dos prompts hardcoded para `agent_prompts`.

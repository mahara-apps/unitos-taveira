# Auditoria READ-ONLY — Execução assíncrona das funcionalidades de IA (MASTER)

Escopo: criação de job, fila, worker, claim/lease, heartbeat, timeout, retry, checkpoint, reaper, concorrência e recuperação após falha.
Nada foi alterado em código, schema ou dados; runs/jobs de teste foram removidos ao final.

## Dois motores distintos

| Motor | Tabela | Claim | Heartbeat | Reaper |
| --- | --- | --- | --- | --- |
| Importação de briefing | `briefing_import_runs` + `briefing_import_steps` | `briefing_import_claim_lease` (CAS, `FOR UPDATE SKIP LOCKED`) | `briefing_import_heartbeat` (30s) | `briefing_import_reap` via cron `briefing-import-reaper` (*/2) |
| Pipeline/IA geral (onboarding, pauta, agentes) | `ai_jobs` | lógica de aplicação (`updated_at`/`created_at`) | só `customer-pipeline` (20s) | `reap_stuck_ai_jobs()` via cron `ai-jobs-reaper` (*/2) |

Crons ativos e executando com sucesso (`cron.job_run_details`): `briefing-import-worker` (* * * * *), `briefing-import-reaper`, `ai-jobs-reaper`.

## Resultados

| # | Mecanismo | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Criação do job | PASS | POST `/api/jobs/analyze-briefing-text` → 202 + `runId`; segunda chamada idêntica → 200 `reused:true` |
| 2 | Dedup sob concorrência | PASS | 4 POSTs simultâneos do mesmo texto → 1 único `runId` (ee38f8c5), 3 `reused:true` |
| 3 | Fila / job inicia | PASS | run passa de `queued` a `proposed` pelo kick `waitUntil` e também pelo cron worker |
| 4 | Claim/lease exclusivo | PASS | `claim_lease(ownerA)` e `(ownerB)` em paralelo sobre 4 runs → 2+2, **overlap 0** |
| 5 | Heartbeat | PASS | `heartbeat(ownerA)` → `true` e lease estendida; `heartbeat(intruso)` → `false`, lease intacta |
| 6 | Timeout de etapa | PASS | `STEP_TIMEOUT_MS` (extract 60s, interpret 120s) com `AbortController` propagado ao provider; estouro vira `ImportStepError` retentável rotulada com a etapa |
| 7 | Retry / attempts | PASS | reaper incrementa `attempt` (0→1) e devolve a `queued`; ao atingir `max_attempts=3` marca `expired` com `error_kind='stalled'` |
| 8 | Checkpoint | PASS | run forçada a `queued`/`resume_step='diff'` → worker retornou `reusedInterpret:true`; `provider_attempts` da etapa interpret inalterado (nenhuma nova chamada de IA) |
| 9 | Etapas de IA não repetidas | PASS | 1 única linha `interpret` por run após múltiplas execuções |
| 10 | Reaper (worker morto) | PASS | lease expirada manualmente → `{requeued:4}`; com tentativas esgotadas → `{expired:4}` |
| 11 | Concorrência de workers | PASS | 2 chamadas paralelas do cron worker com 4 runs: 1 + 3 processadas, **overlap 0**, nenhuma duplicação de etapa |
| 12 | `running` não fica preso | PASS (importação) | lease + reaper garantem saída; nenhuma run presa hoje |
| 13 | Falhas persistidas | PASS | `status`, `error`, `error_kind` gravados (ex.: `analysis`, `stalled`) |
| 14 | Jobs concluídos saem da fila | PASS | `ai_jobs` em `queued`/`running`: 0; runs terminam em `proposed`/`applied`/`failed`/`expired` |
| 15 | UI recebe estado real | PASS | dialog faz polling 2.5s do run + etapas; `ai-jobs-provider` usa Realtime em `ai_jobs` |
| 16 | Instalação limpa | PASS | crons criados por migration idempotente; RPCs com `GRANT` só a `service_role`; fila vazia funciona sem erro |

## FAIL

**F1 — Reaper de `ai_jobs` (5 min) mata trava de pauta cujo TTL é 10 min.**
`reap_stuck_ai_jobs()` marca como `failed` todo `ai_jobs` em `queued`/`running` com `updated_at` > 5 min, sem heartbeat.
`monthly-plan-lock.server.ts` usa `LOCK_TTL_MS = 10 min` e não atualiza `updated_at` durante a geração.
Teste real: lock `monthly_plan` `running` com `updated_at` de 6 min → `reap_stuck_ai_jobs` = 1 → `status:'failed'`, `error:'timeout: worker interrompido antes da conclusão'`.
Consequência: geração legítima acima de 5 min é declarada falha enquanto ainda roda, a trava é liberada e uma segunda geração concorrente pode iniciar (trabalho de IA e pauta duplicados), além de erro falso na UI.

## RISCO

- **R1 — `ai_jobs` sem lease real**: exclusão por janela de tempo (`updated_at`/`created_at`), não por CAS com owner. Duas execuções que iniciam no mesmo instante podem ambas se considerar donas; a proteção é apenas o desempate por `created_at` no lock de pauta.
- **R2 — Reaper de `ai_jobs` não retenta nem retoma**: só marca `failed`. Retomada por checkpoint existe (`monthly-plan-resume.server.ts` lê `ai_jobs.result`), mas depende de ação manual do usuário; não há `attempt`/`max_attempts` na tabela.
- **R3 — Reaper não reconcilia entidades dependentes**: job morto deixa registros satélites (ex.: documento em `queued`) sem status terminal — mesmo achado da auditoria de documentos.
- **R4 — `resume_step` não é limpo no sucesso**: run concluída manteve `resume_step:'diff'`; inofensivo hoje, mas é estado enganoso para diagnóstico.
- **R5 — Cron aponta para a URL publicada** (`project--…lovable.app`): worker/reaper só rodam contra o deploy publicado; mudanças em preview não são exercitadas pelo cron.

## NÃO TESTADO

- Morte real de processo no meio de uma chamada LLM (simulada por expiração de lease, não por kill do runtime).
- Comportamento sob carga alta (dezenas de runs simultâneas) e limites de rate do provider BYOK durante o claim em lote.

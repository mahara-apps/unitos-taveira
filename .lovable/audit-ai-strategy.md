# Auditoria técnica — Geração de Estratégia IA (read-only)

Data: 14/08/2026 · Escopo: pipeline `customer_strategy` (Briefing → Voz → Personas → Cohorts → SWOT)
Nenhum arquivo de aplicação, prompt, agente, migration ou UI foi alterado nesta auditoria.

---

## 1. Resumo executivo

- O erro **"Falha na etapa 'Modelando a voz da marca': No output generated. Check the stream for errors."** não é um bug de parsing nem de schema. É a **mensagem genérica do AI SDK (`ai@7`) quando o stream termina sem nenhum passo concluído** — ou seja, quando o provedor devolveu erro *dentro* do stream.
- **Causa raiz comprovada por dados**: a chave Gemini da marca está estourando **cota / rate-limit do Google** (`429 Quota exceeded for metric: generativelanguage.googleapis…`) e, secundariamente, recebendo `model overloaded` ("This model is currently experiencing high demand"). Evidência direta na tabela `brand_ai_usage` (ver §20).
- A etapa **briefing** passa porque é a **primeira** chamada (cota ainda disponível); **voice** falha logo em seguida (~4 s depois) porque as chamadas são disparadas em sequência imediata, sem espaçamento nem backoff.
- Três defeitos estruturais transformam um erro **transitório e recuperável** em **falha definitiva do job**:
  1. o pipeline de Estratégia usa `streamText` + `await result.text`, e nessa forma o erro real do provedor é engolido e substituído por "No output generated" (perda de diagnóstico);
  2. o retry da Estratégia é **1 tentativa imediata, sem backoff e sem classificação de erro** — reenvia dentro da mesma janela de cota;
  3. não existe **retomada por etapa**: o job falha inteiro e uma nova execução refaz todas as etapas (inclusive as já persistidas), consumindo cota de novo.
- O pipeline de **Copy** (`post-agents.server.ts`), já validado, **não tem nenhum desses três problemas**: usa `generateText` + `Output.object`, `classifyAiError`, backoff `[15s, 45s]`, espaçamento de 4 s entre chamadas e estado `retryable`/`permanent` por peça. A Estratégia é, na prática, **uma infraestrutura paralela mais antiga**.

Severidade geral: 🔴 crítico (bloqueia a geração para qualquer marca em plano gratuito/limitado do Gemini).

---

## 2. Fluxo completo (real, baseado no código)

| # | Camada | Arquivo | Função / símbolo | Entrada | Saída | Banco | Tratamento de erro |
|---|--------|---------|------------------|---------|-------|-------|--------------------|
| 1 | UI | `src/components/brand-hub/briefing-workspace.tsx:288` | `runStrategy()` (botão "Gerar Inteligência com IA", label em `:1298`) | form do briefing | `POST /api/jobs/customer-pipeline` | salva o form antes (`save.mutateAsync()`) | `toast.error(...)` genérico |
| 1b | UI alternativa | `src/components/brand-hub/quick-onboarding-wizard.tsx:152` e `src/components/customer/customer-dashboard.tsx:299` | mesmo endpoint | idem | idem | — | idem |
| 2 | HTTP | `src/routes/api/jobs/customer-pipeline.ts:794` | handler `POST` | `Authorization: Bearer <jwt>` + `{brandId, clientId, texto?}` | `202 {jobId}` | — | 401 sem token; 400 schema; 404 cliente |
| 3 | Composição de contexto | mesmo arquivo `:78` | `composeBriefingFromRecord()` | `clients` + `clients.brand_hub` + `client_documents.ai_summary` + último `brand_briefings.data` | texto único (`state.texto`) + `sources` | leitura | guard: `composed.length < 40` → 400 |
| 4 | Enfileiramento | `:886` | insert em `ai_jobs` | estado inicial | `job.id` | `ai_jobs` (`kind = customer_strategy`) | 500 se insert falhar |
| 5 | Execução | `:545` | `runStep({step})` via `waitUntil` | `ai_jobs.input` | persistência por etapa | `ai_jobs` (heartbeat 20 s) | `try/catch` global → `status: failed` |
| 6 | Chamada ao modelo | `:316` | `runJson()` | `system` + `prompt` | JSON parseado | — | `withTimeout(90s)` + **1 retry imediato** |
| 7 | Modelo | `src/lib/ai-provider.server.ts:284` | `getBrandAiModel` / `getBrandAiModelAdmin` | `brandId`, `kind=text`, `role` | `{provider, modelId, model}` | `brand_connections`, `brand_api_credentials`, `ai_model_catalog_overrides` | erros `ai_provider_not_configured` / `ai_provider_key_missing` / `ai_model_unavailable` |
| 8 | Instrumentação | `ai-provider.server.ts:120` | `withModelInstrumentation` | chamadas `doGenerate`/`doStream` | tokens + fallback de modelo | `brand_ai_usage`, `ai_model_catalog_overrides` | fallback só para "modelo indisponível" |
| 9 | Parser | `customer-pipeline.ts:294` | `parseJsonLoose` | texto | objeto | — | `Error("A IA não retornou JSON válido.")` |
| 10 | Normalização | `:372`–`:497` | `normalize*Payload` | objeto cru | shape canônico | — | tolerante (aliases PT/EN, nunca lança) |
| 11 | Persistência | `:523` | `replaceActive()` | payload normalizado | linha nova `is_active` | `brand_voice_cards`, `brand_personas`, `brand_cohorts`, `brand_swot`, `brand_briefings` | lança em erro de insert |
| 12 | Encadeamento | `:738` | `scheduleStep()` | próxima etapa | novo POST na mesma rota | `ai_jobs` | 2 tentativas + execução inline; marca `failed` no fim |
| 13 | Conclusão | `:688`–`:713` | notificação + `status: succeeded` | — | `notifications` + `ai_jobs.result` | `notifications` | `console.warn` |
| 14 | UI final | indicador de "Gerações de IA" | lê `ai_jobs` | `status`, `progress`, `step_label`, `error` | — | `ai_jobs` | exibe `ai_jobs.error` literal |

**Zod entra apenas como tipo** (`z.infer`) — os schemas de §2 **não são usados para validar** a saída do modelo (`.parse()` nunca é chamado nas etapas). Quem garante o shape são os normalizadores.

---

## 3. Todas as etapas (`STEPS` em `customer-pipeline.ts:25`)

| Etapa | Label | Progresso | Papel do modelo | Prompt | Input | Output esperado | Persistência | Erros possíveis |
|---|---|---|---|---|---|---|---|---|
| `briefing` | Estruturando briefing | 5% | `operational` | `P.briefing:352` | `state.texto` (briefing composto) | `publico_alvo, tom_de_voz, dores[], diferenciais[], hashtags[], concorrentes[], volume_semanal_estimado, completude_percentual` | `brand_briefings` (merge com o registro mais recente) | JSON inválido, quota, timeout |
| `voice` | **Modelando a voz da marca** | 25% | `strategic` | `P.voice:354` | `JSON.stringify(state.briefing)` | `voice_card{brand_personality, tone_characteristics[], vocabulary_rules{words_to_use[],words_to_avoid[]}, brand_phrases_examples[]}` | `brand_voice_cards` (desativa ativo + insert) | **quota/429, overloaded, "No output generated"** |
| `personas` | Desenhando personas | 45% | `strategic` | `P.personas:356` | briefing | `personas[]` (3–5) | `brand_personas` | além dos acima: `"Nenhuma persona gerada"` (`:644`) — único guard de vazio do pipeline |
| `cohorts` | Construindo cohorts | 65% | `strategic` | `P.cohorts:358` | briefing + `compactPersonas` | `cohorts[]` | `brand_cohorts` | idem |
| `swot` | Analisando SWOT | 85% | `strategic` | `P.swot:360` | briefing + personas + cohorts | `swot_analysis{...}` + `competitive_matrix[]` | `brand_swot` | idem |

### O que acontece exatamente em "Modelando a voz da marca" (`:625`–`:635`)

1. `runJson({system: P.voice, prompt: "Briefing estruturado:\n" + JSON.stringify(state.briefing), strategic: true, brandId})`.
2. `getBrandAiModelAdmin(brandId, "text", "strategic", {agent: "customer.pipeline.strategic"})` → resolve `gemini` + `gemini-flash-latest` (catálogo `ai-models-catalog.server.ts:39`; **strategic e operational apontam para o mesmo modelo**).
3. `streamText({model, system, prompt})` e `await result.text` dentro de `withTimeout(90_000)`.
4. `parseJsonLoose` → `normalizeVoicePayload` → `replaceActive("brand_voice_cards")`.
5. Qualquer erro sobe para o `catch` de `runStep:712` e vira `ai_jobs.error = 'Falha na etapa "Modelando a voz da marca": <msg>'` com `status: failed`.

Não há guard de vazio nessa etapa: se o modelo devolvesse `{}`, o voice card seria gravado com strings vazias (🟠, ver P-07).

---

## 4. Origem exata de "No output generated. Check the stream for errors."

**Não é do Gemini, nem do parser, nem do frontend.** É do pacote `ai@7`:

- `node_modules/ai/dist/index.js:8842-8845` — no `flush` do stream de `streamText`: se `recordedSteps.length === 0` ou existe `recordedNoOutputError`, ele **rejeita todas as promises do resultado** (inclusive `result.text`) com `new NoOutputGeneratedError({ message: "No output generated. Check the stream for errors." })`.
- Classe em `:274` (`AI_NoOutputGeneratedError`); variante irmã em `:9511` ("The model stream ended without a finish chunk").

Consequência crítica: **o erro real do provedor vira `cause` e é descartado**. O pipeline lê apenas `err.message` (`customer-pipeline.ts:713`), então o usuário vê a mensagem genérica em vez de "cota excedida". Isso é perda de observabilidade, não a causa.

Causas possíveis descartadas / confirmadas:

| Hipótese | Veredito | Evidência |
|---|---|---|
| Resposta vazia legítima do modelo | descartado | erro ocorre em <2 s, sem tokens de saída |
| Schema/structured output incompatível | **descartado** — a Estratégia **não usa** structured output; pede JSON por prompt | `runJson:330` só passa `system`+`prompt` |
| Markdown envolvendo o JSON | descartado | `parseJsonLoose:294` já remove ```` ``` ```` e recorta `{...}` |
| Timeout | descartado como causa primária | `LLM_TIMEOUT_MS = 90s`; as falhas registradas ocorrem em segundos |
| Modelo indisponível/descontinuado | descartado | `ai_model_catalog_overrides` está **vazio**; `gemini-flash-latest` respondeu com sucesso na etapa `briefing` no mesmo minuto |
| API key inválida / auth | descartado | a chamada `operational` imediatamente anterior teve sucesso (1040 in / 266 out tokens) |
| Conteúdo bloqueado (safety) | improvável | mensagens registradas são de cota/demanda, não de `SAFETY` |
| **Quota / rate limit (429)** | **CONFIRMADO** | `brand_ai_usage` — ver §20 |
| **Modelo sobrecarregado (503 "high demand")** | **CONFIRMADO (secundário)** | mesma tabela |
| Frontend interpretando resposta válida como vazia | descartado | o frontend só lê `ai_jobs.error` |

---

## 5. Configuração do modelo

| Item | Estratégia |
|---|---|
| BYOK | sim — `brand_api_credentials.ciphertext` descriptografado por `decryptCredential` (`ai-provider.server.ts:88`) |
| Seleção de provider | `brand_connections.text_provider` com fallback para o primeiro `providers[*].connected` (`:60`) |
| Model ID | `resolveModel(provider, role)` → override em `ai_model_catalog_overrides` (hoje **vazio**) ou default do catálogo |
| Modelo em uso (Gemini) | `strategic = operational = gemini-flash-latest` |
| Fallback | `MODEL_FALLBACKS` — **só dispara quando `isModelUnavailableError(msg)` é verdadeiro, e esse predicado exclui explicitamente `quota`/`rate limit`** (`ai-models-catalog.server.ts:186`) |
| temperature / topP / maxOutputTokens / generationConfig / responseMimeType | **não configurados em nenhum lugar** — defaults do SDK |
| System instruction | string inline em `P` (`customer-pipeline.ts:350`) |
| Structured output / schema no request | **não usa** |
| Streaming | sim (`streamText`), consumido no servidor |
| Retry | 1 retry imediato em `runJson:344`; `maxRetries` do SDK **não é desligado** (default 2 internas) → até ~6 chamadas reais por etapa contra a mesma cota |
| Timeout | 90 s por chamada (`withTimeout`) + heartbeat de 20 s + reaper de 5 min |
| Orçamento | `assertBudget` via RPC `check_ai_usage_budget` (best-effort) |

Infraestrutura compartilhada: **sim para o provider** (`getBrandAiModel*`), **não para a execução** (streaming + retry próprios, prompts inline, sem `agent_prompts`, sem `classifyAiError`). Não há chamada direta ao endpoint do Gemini; não há SDK divergente; não há função morta detectada — mas `runJson` é um wrapper paralelo ao `runStructured` da Copy.

---

## 6. Contexto enviado à IA

Origem única: `composeBriefingFromRecord` (`customer-pipeline.ts:78`), a partir de três leituras (`:833`).

| Bloco | Campos lidos | Origem | Transformação | Chega ao modelo como |
|---|---|---|---|---|
| Identidade | `name`, `niche`, `color`, `tone_of_voice`/`brand_hub.tone_text`, `mission`, `positioning`, `values` | `clients` + `brand_hub` | `push(label, value)` — ignora vazio | linhas `Label: valor` |
| Produto | `offer`, `price_range`, `differentials`, `objections` | `brand_hub` | idem | idem |
| Público | `audience`, `journey`, `pain_points`, `desires` | `brand_hub` | idem | idem |
| Concorrentes | `competitors[].handle`, `inspirations` | `brand_hub` | extrai handles | lista separada por vírgula |
| Estética | `palette[].hex`, `hashtags`, `do_dont.do/dont` | `brand_hub` | prefixa `#` | idem |
| Metas/volumetria | `volumetry`, `volumetry_basis`, `formats`, `goals` | `brand_hub` | serializa `canal: N/sem` | uma linha |
| Contato/canais | `contact_name`, `contact_email`, `socials` | `clients` | join | uma linha |
| Briefing anterior | último `brand_briefings.data` | tabela | máx. 40 chaves | bloco "Contexto consolidado" |
| Documentos | `client_documents.ai_summary` (8 mais recentes) | tabela | `JSON.stringify().slice(0,1500)` | bloco "Documentos analisados" |
| Notas do usuário | `texto` (opcional, ≤20k) | request | anexo | "Notas adicionais do usuário" |

**Não são enviados** (mesmo existindo no sistema): performance/analytics de posts, dados sociais conectados (`client_social_accounts`), pautas anteriores (`monthly_plans`), estratégia anterior (voice/personas/cohorts/SWOT já ativos), histórico do Cérebro (`brain_memory` / `brain_insights`), site/`description`/`cnpj` do cliente. Isso é uma lacuna de qualidade (🟡 P-09), não de estabilidade.

Nas etapas 2–5, o contexto **não é o texto composto**: é apenas `JSON.stringify(state.briefing)` (+ resumos compactos). Se a etapa `briefing` degradar, todas as demais herdam um contexto pobre.

---

## 7. Campos vazios e validação

- Única validação de entrada: `composed.length < 40` (`:872`).
- `push()` ignora `null`/`undefined`/`""`/arrays vazios — nunca envia `undefined` literal, mas **envia um briefing quase vazio sem avisar** se o Cérebro estiver em branco.
- `briefingJson()` (`:582`) faz `state.briefing ?? {}` → se a etapa `briefing` tivesse gravado objeto vazio, a etapa `voice` receberia literalmente `{}`.
- `compactPersonas(state.personas ?? {personas: []})` e `compactCohorts(...)` → podem enviar **string vazia** para cohorts/SWOT.
- Guard de saída vazia existe **só em personas** (`:644`). `voice`, `cohorts` e `swot` gravam mesmo com conteúdo vazio.
- Nenhum campo é formalmente obrigatório por etapa; nenhum `.parse()` de Zod é executado.

---

## 8. Prompts

| Prompt | Local | Tipo | Tamanho | Variáveis | Formato exigido | Schema | Duplicação |
|---|---|---|---|---|---|---|---|
| `P.briefing` | `customer-pipeline.ts:352` | inline | ~400 chars | — | "SOMENTE JSON, sem markdown" | `BriefingSchema` (só tipo) | — |
| `P.voice` | `:354` | inline | ~330 chars | — | JSON, chaves em inglês | `VoiceSchema` (só tipo) | conceito repetido em `agent_prompts` do pipeline de Copy |
| `P.personas` | `:356` | inline | ~300 chars | — | JSON | `PersonasSchema` | — |
| `P.cohorts` | `:358` | inline | ~280 chars | — | JSON | `CohortsSchema` | — |
| `P.swot` | `:360` | inline | ~300 chars | — | JSON | `SwotSchema` | — |

Nenhum prompt da Estratégia vem do banco (`agent_prompts` / `agent_prompt_overrides` são usados apenas pelo pipeline de Copy). Ou seja: **o cliente não consegue customizar os prompts da Estratégia**, ao contrário da Copy (🟡 P-10).

Compatibilidade PROMPT ↔ SCHEMA ↔ PARSER ↔ BANCO: coerente. Os prompts pedem chaves canônicas; os normalizadores ainda aceitam aliases PT-BR; o banco recebe JSONB em `data`. Não encontrei divergência de nomes que justifique a falha atual.

---

## 9. Structured output

A Estratégia **não usa** structured output (`Output.object`, `responseMimeType`, `responseSchema`). Consequências:

- O contrato é só textual → depende do modelo obedecer;
- os schemas Zod declarados servem apenas de tipo, sem validação em runtime;
- em compensação, não há risco de 400 por schema — e portanto **structured output não pode ser a causa do erro atual**.

A Copy faz o oposto: `Output.object({schema})` + recuperação de `NoObjectGeneratedError` lendo `err.text` (`post-agents.server.ts:143`).

---

## 10. Streaming

- Começa em `runJson:330` (`streamText`); é consumido **no próprio servidor** por `await result.text` — nada é transmitido ao browser.
- Chunks são acumulados pelo SDK; o wrapper `instrumentStream` (`ai-provider.server.ts:157`) apenas mede tokens via `TransformStream` e repassa.
- Fim do stream: `flush` do SDK. **Sem chunks / com erro no stream** → `NoOutputGeneratedError` (§4).
- Erros que chegam como `part.type === "error"` **não são lançados por `doStream`** — logo o `try/catch` do fallback em `attempt` (`ai-provider.server.ts:186`) **nunca vê esses erros** e a cadeia `MODEL_FALLBACKS` não roda em streaming. O `instrumentStream` registra o erro em `brand_ai_usage` (foi assim que a causa foi provada), mas não o propaga com a mensagem original.
- Sem cancelamento, sem `abortSignal`, sem race condition detectada.
- **Streaming é desnecessário aqui**: nada é renderizado progressivamente; o objetivo declarado no comentário (`:311`) é manter bytes fluindo, mas cada etapa dura segundos e já existe heartbeat de 20 s no `ai_jobs`.

---

## 11. Retry e resiliência

| Aspecto | Estratégia | Copy |
|---|---|---|
| Tentativas | 2 (imediatas) por etapa + `maxRetries` default do SDK não desligado | 3 (`BACKOFF_MS.length + 1`), `maxRetries: 0` no SDK |
| Backoff | **nenhum** | `[15s, 45s]` |
| Espaçamento entre chamadas | nenhum (etapas em sequência imediata) | `SPACING_MS = 4000` |
| Classificação de erro | nenhuma (`provider_quota`, `rate_limit`, `unavailable`, `timeout`, `empty_output`, `invalid_output`, `malformed_json` **não existem**) | `classifyAiError` cobre todos |
| Recuperação de JSON malformado | `parseJsonLoose` | `parseJsonLoose` + `NoObjectGeneratedError.text` |
| Estado retryable/permanente | não existe | `ai_phase` retryable/permanent por peça |

Reforçando o efeito prático: as 2 tentativas ocorrem **dentro da mesma janela de rate-limit**, garantindo que uma quota de 429 derrube a etapa.

---

## 12. Estado da geração e retomada

- Estado vive em `ai_jobs`: `status` (`queued|running|succeeded|failed`), `progress`, `step_label`, `input` (JSONB com `JobState`), `result`, `error`, `started_at`, `finished_at`, `updated_at` (heartbeat de 20 s), `kind = customer_strategy`.
- Resultados parciais **são preservados no banco de destino** (o voice card/personas já gravados continuam ativos) e o `JobState` acumulado fica em `ai_jobs.input`.
- **Não existe retomada**: nenhuma UI ou rota permite continuar um job `failed` a partir da etapa que quebrou. Regenerar recomeça em `briefing` e refaz tudo — 5 chamadas de cota novamente.
- Riscos de dados:
  - `replaceActive` **desativa o registro ativo antes** de inserir o novo (`:530`). Se o insert falhar, a marca fica **sem voice card ativo** (🟠 P-05).
  - Regeneração parcial cria mistura de versões: briefing e voz novos, personas/cohorts/SWOT antigos ainda ativos, sem marcação de versão conjunta (🟠 P-06).

---

## 13. Banco de dados

| Tabela | Papel | Colunas relevantes |
|---|---|---|
| `ai_jobs` | orquestração | `kind`, `status`, `progress`, `step_label`, `input` (JSONB `JobState`), `result`, `error`, `started_at`, `finished_at`, `updated_at` |
| `brand_briefings` | briefing estruturado | `data` (JSONB, merge), `raw_text`, `completude` |
| `brand_voice_cards` | voz | `data` (JSONB), `is_active`, `created_by` |
| `brand_personas` | personas | idem |
| `brand_cohorts` | cohorts | idem |
| `brand_swot` | SWOT + matriz | idem |
| `brand_ai_usage` | consumo/erros | `agent`, `model`, tokens, `cost_usd`, `success`, `error_message` |
| `ai_model_catalog_overrides` | modelo promovido em runtime | vazio hoje |
| `notifications` | aviso de conclusão | `kind: system` |

Não há coluna de versão/agrupamento entre as quatro tabelas de estratégia, nem `draft`.

---

## 14. Concorrência

- **Não há guard de job duplicado**: dois cliques disparam dois `POST` e dois `INSERT` em `ai_jobs`, ambos rodando as 5 etapas em paralelo — dobra consumo de cota (o que **agrava a causa raiz**) e produz duas gravações em `brand_voice_cards`, com o último `insert` vencendo. 🔴 P-02.
- Recarregar a página **não** aborta nada: o job roda em `waitUntil` no servidor.
- A UI só desabilita o botão localmente (`setGenerating`), o que não protege contra duas abas ou dois usuários.

---

## 15. Observabilidade

| Dado | Disponível? | Onde |
|---|---|---|
| cliente / marca | sim | `ai_jobs`, `brand_ai_usage` |
| execução (job) | sim | `ai_jobs.id` |
| etapa | parcial | `ai_jobs.step_label` (sobrescrito; sem histórico) |
| agente | sim | `brand_ai_usage.agent` (`customer.pipeline` / `.strategic`) |
| modelo | sim | `brand_ai_usage.model` + `ai_jobs.input.models` |
| tentativa | **não** | retry só vira `console.warn` |
| duração por etapa | **não** | só `started_at`/`finished_at` do job |
| sucesso/erro | sim | ambas as tabelas |
| **erro real do provedor** | **só em `brand_ai_usage`** | `ai_jobs.error` recebe a mensagem mascarada do SDK |
| `failure_kind` | **não existe** para Estratégia | existe na Copy (`classifyAiError`) |
| `activity_events` | **não é alimentado** pela Estratégia | — |

---

## 16. Estratégia × Copy

| Item | Estratégia IA | Copy | Diferença | Risco |
|---|---|---|---|---|
| BYOK | `getBrandAiModelAdmin` | `getBrandAiModelAdmin` | igual | — |
| Provider | `brand_connections` | idem | igual | — |
| Modelo | papel `strategic` (= flash-latest) | papel `operational` | Estratégia paga mais caro em teoria, mesmo modelo na prática | 🔵 |
| Prompt | inline no arquivo | `agent_prompts` no banco (customizável) | Estratégia não é editável | 🟡 |
| Agente | função anônima `runJson` | agentes nomeados (roteirista, copywriter) | sem rastreio por agente | 🟡 |
| Retry | 2× imediato | 3× com backoff 15s/45s | **causa da falha** | 🔴 |
| Quota | não classificada, sem espaçamento | `provider_quota` retryable + `SPACING_MS` | **causa da falha** | 🔴 |
| Streaming | `streamText` + `await text` | `generateText` | mascara o erro real | 🔴 |
| Parsing | `parseJsonLoose` | `Output.object` + recuperação de `err.text` | menos garantido | 🟠 |
| Structured output | não usa | usa | shape não garantido | 🟠 |
| Observabilidade | `ai_jobs` + usage | usage + `logAttempt` + `ai_phase` | sem tentativa/duração/kind | 🟡 |
| Idempotência | nenhuma | por peça (`post.id`) | duplicação | 🔴 |
| Retomada | inexistente | `ai_phase: retryable` reprocessável | refaz tudo | 🟠 |
| Tratamento de erro | mensagem genérica | classificada e persistida | usuário não sabe que é cota | 🟠 |

**Conclusão**: sim, a Estratégia roda sobre uma infraestrutura paralela e mais antiga que a Copy. Só o acesso ao provider é compartilhado.

---

## 17. Dependências (quem consome o resultado)

- `brand_briefings.data` → Briefing workspace, contexto de pauta (`monthly-plan-context.server.ts`), `loadBriefingContext` usado pela Copy.
- `brand_voice_cards.data.voice_card` → prompts de Copy (tom/vocabulário), Brand Hub, Pauta.
- `brand_personas.data.personas` → Pauta (público-alvo dos temas), cohorts, Copy.
- `brand_cohorts.data.cohorts` → Pauta e segmentação de conteúdo.
- `brand_swot.data` → painel de estratégia e prompts de posicionamento.
- `ai_jobs` → indicador "Gerações de IA" no topo.

Campos consumidos posteriormente (não podem mudar de nome numa correção): `voice_card.brand_personality`, `tone_characteristics`, `vocabulary_rules.words_to_use/avoid`, `brand_phrases_examples`; `personas[].nome/descricao/dores/desejos/canais_preferidos`; `cohorts[].name/behavioral_traits/content_strategy`; `swot_analysis.*`.

---

## 18. Problemas classificados

| ID | Sev | Arquivo:linha | Causa | Impacto | Evidência | Recomendação | Risco de regressão |
|---|---|---|---|---|---|---|---|
| P-01 | 🔴 | `customer-pipeline.ts:338-345` | retry imediato, sem backoff nem classificação; `maxRetries` do SDK não desligado | 429 derruba o job | `brand_ai_usage`: 4 erros de cota em 12 s | reusar `classifyAiError` + backoff da Copy | baixo |
| P-02 | 🔴 | `customer-pipeline.ts:794` | sem guard de job ativo | duplica execução e cota | ausência de checagem no handler | recusar novo job com `status in (queued,running)` | baixo |
| P-03 | 🔴 | `customer-pipeline.ts:330-335` + `ai-provider.server.ts:157` | erro do provedor chega como chunk `error`; `streamText` mascara com `NoOutputGeneratedError`; fallback não enxerga | usuário e log perdem a causa | `ai/dist/index.js:8842` | usar `generateText` ou propagar `error.cause` | médio (muda mensagens) |
| P-04 | 🟠 | `customer-pipeline.ts:585-673` | etapas em sequência imediata | estoura RPM do Gemini | 5 chamadas em <60 s | espaçamento entre etapas | baixo |
| P-05 | 🟠 | `customer-pipeline.ts:530-542` | desativa o ativo antes do insert | marca pode ficar sem voice card | ordem das queries | inserir e só então desativar | baixo |
| P-06 | 🟠 | pipeline inteiro | sem versão conjunta / sem retomada | estratégia meio nova, meio antiga | ausência de coluna de versão | retomar por etapa | médio |
| P-07 | 🟠 | `:632`, `:655`, `:670` | sem guard de payload vazio (só personas tem) | grava voice/cohorts/SWOT vazios | comparar com `:644` | validar com os Zod já declarados | baixo |
| P-08 | 🟡 | `:294-309` / ausência de `Output.object` | contrato só textual | shape depende do modelo | — | structured output como a Copy | médio |
| P-09 | 🟡 | `:78-216` | contexto ignora performance, pautas, estratégia anterior e Cérebro | qualidade inferior | lista em §6 | enriquecer depois da correção | baixo |
| P-10 | 🟡 | `:350-361` | prompts inline, fora de `agent_prompts` | não customizável, sem versionamento | — | migrar para o banco | médio |
| P-11 | 🟡 | `runStep` | sem `activity_events`, sem duração/tentativa/`failure_kind` | difícil diagnosticar | §15 | logar tentativa e kind | baixo |
| P-12 | 🔵 | `ai-models-catalog.server.ts:39` | `strategic == operational` no Gemini | papel "estratégico" é fictício | catálogo | revisar quando houver cota Pro | baixo |

---

## 19. Causa raiz do erro atual

**Por que "Modelando a voz da marca" retorna "No output generated"?**

1. **Causa mais provável (comprovada)**: a chave Gemini da marca está **sem cota / em rate-limit** (`429 — Quota exceeded for metric: generativelanguage.googleapis…`), com episódios intercalados de **modelo sobrecarregado** ("This model is currently experiencing high demand"). Como o erro chega dentro do stream, `streamText` rejeita `result.text` com a mensagem genérica do SDK, que o pipeline copia para `ai_jobs.error`.

2. **Evidência** (`brand_ai_usage`, 14/08/2026):

   | horário | agente | modelo | sucesso | erro |
   |---|---|---|---|---|
   | 16:05:48 | `customer.pipeline` (briefing) | gemini-flash-latest | ✅ | — (1040 in / 266 out) |
   | 16:05:52 | `customer.pipeline.strategic` (voice) | gemini-flash-latest | ❌ | "This model is currently experiencing high demand…" |
   | 16:05:54 → 16:06:04 | `customer.pipeline.strategic` | gemini-flash-latest | ❌ ×4 | "You exceeded your current quota… Quota exceeded for metric: generativelanguage.googleapis" |

   Reforços: `ai_model_catalog_overrides` está vazio (nenhum problema de modelo descontinuado) e a etapa anterior, com **a mesma chave e o mesmo modelo**, teve sucesso 4 s antes — o que descarta chave inválida, modelo inexistente, prompt inválido e schema.

3. **Arquivos envolvidos**: `src/routes/api/jobs/customer-pipeline.ts` (`runJson`, `runStep`), `src/lib/ai-provider.server.ts` (`withModelInstrumentation`), `src/lib/ai-models-catalog.server.ts` (`isModelUnavailableError`), `node_modules/ai/dist/index.js` (`NoOutputGeneratedError`).

4. **Caminho de execução**: botão → `POST /api/jobs/customer-pipeline` → `runStep("briefing")` ✅ → `scheduleStep("voice")` → `runStep("voice")` → `runJson(strategic)` → Gemini 429 dentro do stream → `await result.text` rejeita → retry imediato → 429 de novo → `catch` em `:712` → `ai_jobs.status = failed`.

5. **Fatores secundários**: retry sem backoff (P-01); ausência de espaçamento entre etapas (P-04); `isModelUnavailableError` (corretamente) não trata cota, mas nada mais trata (P-01); streaming mascarando a mensagem (P-03); possível duplo clique dobrando o consumo (P-02).

6. **Como comprovar sem alterar o sistema**:
   - `select created_at, agent, model, success, error_message from brand_ai_usage where agent like 'customer.pipeline%' order by created_at desc limit 20;` — mostra os 429 correlacionados no minuto da falha;
   - conferir no Google AI Studio (mesma chave) o painel de rate limits do projeto;
   - repetir a geração após ~1 minuto de ociosidade: a etapa `voice` costuma passar quando a janela de cota reabre (o próprio histórico mostra sucesso em `briefing` no mesmo cenário).

---

## 20. Plano de correção proposto (não executado)

**FASE 1 — causa raiz: resiliência a cota**
Objetivo: nenhuma etapa cair por 429/sobrecarga.
Arquivos: `src/routes/api/jobs/customer-pipeline.ts`.
Alterações: importar `classifyAiError` de `post-agents.server.ts`; substituir o retry imediato por backoff `[15s, 45s]`; `maxRetries: 0` na chamada; espaçamento entre etapas.
Risco: baixo. Dependências: nenhuma. Teste: gerar estratégia com cota apertada e verificar que `voice` conclui após backoff.

**FASE 2 — mensagem de erro verdadeira**
Objetivo: acabar com "No output generated" na UI.
Alterações: trocar `streamText`+`await text` por `generateText` (a UI não consome stream) ou desempacotar `err.cause`; mapear `provider_quota` para uma mensagem em português com orientação de plano/cota.
Risco: médio (muda texto de erro). Teste: forçar 429 e conferir `ai_jobs.error`.

**FASE 3 — parsing e structured output**
Objetivo: garantir o shape.
Alterações: `Output.object({schema})` com os Zod já declarados, mantendo `parseJsonLoose` como fallback; validar payload vazio em `voice`, `cohorts` e `swot` como já é feito em `personas`.
Risco: médio (Gemini pode rejeitar schemas grandes — manter fallback). Teste: rodar as 5 etapas e conferir as 4 tabelas.

**FASE 4 — idempotência e retomada**
Objetivo: um job por cliente e retomada a partir da etapa que falhou.
Alterações: guard de job ativo no handler; ação "Continuar" reutilizando `ai_jobs.input`; inverter a ordem insert→desativar em `replaceActive`.
Risco: médio. Teste: duplo clique; falha proposital em `cohorts` e retomada.

**FASE 5 — observabilidade**
Objetivo: saber etapa, tentativa, duração e `failure_kind`.
Alterações: registrar tentativas em `activity_events` (ou colunas de `ai_jobs`); persistir `failure_kind`.
Risco: baixo.

**FASE 6 — contexto e prompts**
Objetivo: qualidade.
Alterações: mover prompts para `agent_prompts`; enriquecer contexto com estratégia anterior, pautas e Cérebro.
Risco: médio (muda saída da IA).

### Plano de testes (ponta a ponta)
1. Cliente com Cérebro completo → 5 etapas, 4 tabelas populadas, notificação criada, `ai_jobs.status = succeeded`.
2. Cliente quase vazio → bloqueio em `composed.length < 40`.
3. Cota estourada → backoff, conclusão ou erro em português citando cota.
4. Duplo clique → um único job.
5. Falha proposital no meio → etapas anteriores preservadas e retomada possível.
6. Regressão: Pauta e Copy continuam lendo voice/personas/cohorts/SWOT com os mesmos nomes de campo (§17).

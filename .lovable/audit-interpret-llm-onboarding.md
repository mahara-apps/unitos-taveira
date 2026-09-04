# Auditoria READ-ONLY — estágio `interpret` (LLM) do Onboarding Rápido

Nada foi alterado. Escopo: apenas o passo `interpret` das duas rotas de análise
(`/api/jobs/analyze-document` e `/api/jobs/analyze-briefing-text`), que é o
mesmo executor usado pelo Onboarding Rápido.

Cadeia real: rota → `generateBriefingAnalysis`
(`src/lib/briefing-ai-executor.server.ts`) → `getBrandAiCandidatesAdmin`
(`src/lib/ai-provider.server.ts`) → AI SDK por provider.

## 1. Providers e modelos usados

Nenhum modelo é fixo no código do interpret: vem de `brand_connections`
(BYOK, papel `operational`) resolvido por `resolveModel`
(`src/lib/ai-models-catalog.server.ts`).

| Provider | Modelo `operational` (default compilado) | Cadeia de fallback de modelo (mesmo provider) |
| --- | --- | --- |
| gemini | `gemini-flash-latest` | `gemini-flash-latest`, `gemini-3.6-flash`, `gemini-2.5-flash` |
| groq | `llama-3.3-70b-versatile` | `llama-3.3-70b-versatile`, `openai/gpt-oss-20b`, `llama-3.1-8b-instant` |
| openai | `gpt-5-mini` | `gpt-5-mini`, `gpt-4.1-mini`, `gpt-4o-mini` |
| anthropic | `claude-sonnet-4-5` | `claude-sonnet-4-5`, `claude-3-5-haiku-latest` |

Overrides gravados em `ai_model_catalog_overrides` (cache de 5 min) têm
precedência sobre a tabela acima — o modelo efetivo em produção pode divergir
do default compilado. Instanciação em `instantiateProviderModel`
(`@ai-sdk/google | groq | openai | anthropic`).

Candidatos por execução: exatamente **2 no máximo** — `text_provider` e
`text_fallback_provider` da brand (`getBrandAiCandidates`, linhas 536-580).

## 2. Schema JSON enviado a cada provider

Fonte única: `BriefingAnalysisSchema` (`src/lib/briefing-analysis-schema.ts`)
— `executive_summary`, `material_type`, `extracted_text`, `briefing` (15
campos), `evidence[]`, `speakers[]`, `confidence`. Todos declarados; ausência é
`null`/`[]`.

O **mesmo** schema é enviado por dois caminhos diferentes:

- **Gemini**: como `inputSchema` de uma tool (`extract_client_fields`) com
  `toolChoice: { type: "tool" }` — a saída vem em `toolCalls[].input`
  (executor, linhas 43-60).
- **Todos os outros (Groq/OpenAI/Anthropic)**: como `Output.object({ schema })`
  → `response_format` json_schema (executor, linhas 62-70).

Pós-processamento comum: `normalizeBriefingAnalysis` aceita um schema
"recuperável" (parciais/opcionais) e aplica os limites de tamanho
(400/700/300/4000 chars, 20 evidências, 20 participantes, 30 hashtags).

## 3. Parâmetros por provider

| Parâmetro | Gemini | Groq | OpenAI | Anthropic |
| --- | --- | --- | --- | --- |
| `maxOutputTokens` | 8.192 | 8.192 | 8.192 | 8.192 |
| `temperature` | não enviado | não enviado | não enviado | não enviado |
| structured output | tool calling forçado | `structuredOutputs: true` + `strictJsonSchema: true` | `Output.object` sem provider options | idem OpenAI |
| `reasoningEffort` | — | `"low"` | — | — |

`briefingProviderOptions` (`src/lib/briefing-generation.server.ts`) só trata
`groq`; qualquer outro provider recebe `{}`. Consequências já observadas no
histórico: `reasoningEffort` é aplicado a **todo** modelo Groq, inclusive os que
não aceitam o campo (HTTP 400), e `strictJsonSchema` exige que
`confidence/evidence/speakers` estejam em `required` do JSON Schema emitido.
Não há nenhuma opção específica para OpenAI/Anthropic (ex.: `structuredOutputs`
estrito na OpenAI), então esses providers usam modo JSON não estrito.

## 4. Limites de tokens por modelo

**Não existe nenhuma tabela de limites por modelo no código.** Só há um teto
global de saída (`BRIEFING_MAX_OUTPUT_TOKENS = 8_192`) aplicado a todos.
Nenhum controle de janela de contexto nem de TPM por provider/modelo antes do
envio. É exatamente daí que vem o erro real registrado
(`Request too large ... TPM Limit 8000, Requested 25841` no Groq).

## 5. Tamanho máximo do material antes do `interpret`

| Ponto | Limite | Arquivo |
| --- | --- | --- |
| Arquivo enviado | 25 MB (Base64 no navegador, ~33 MB no corpo JSON) | `briefing-import-ui.ts:21`, `brand-hub.functions.ts:527` |
| Texto extraído no navegador | 60.000 chars | `briefing-import-extract.ts:56` |
| Texto extraído no servidor | 120.000 chars + marcação `[conteúdo truncado]` | `document-extract.server.ts:109` |
| Corpo da rota de texto | `min 40` / `max 400.000` chars (Zod) | `analyze-briefing-text.ts:27` |
| Briefing atual injetado no prompt | 12.000 chars | `analyze-briefing-text.ts:80` |
| PDF/imagem | não truncável — vai inline em Base64 no `content` | `analyze-document.ts:158-166` |

Os cortes são por **caracteres**, nunca por tokens, e são maiores que a janela
prática do candidato mais fraco. Nenhum deles é sensível ao provider escolhido.

## 6. Tratamento do 503 do Gemini

`classifyAiError` (`ai-failures.server.ts:159-170`) mapeia status ≥ 500,
`overloaded`, `high demand`, `unavailable`, `timeout`, `fetch failed` →
`provider_unavailable`, `retryable: true`.

No executor do briefing (linhas 99-117), isso **não gera nenhuma nova tentativa
no Gemini**: apenas habilita a troca para o próximo candidato. Se o Gemini for o
único provider conectado, o 503 é terminal na primeira ocorrência.

## 7. Como o Groq é acionado

Somente como **segundo candidato**, quando é o `text_fallback_provider` da
brand, está `connected` e tem credencial decifrável
(`getBrandFallbackProviderKey`, linhas 145-179) — e apenas se a falha do
primeiro candidato for classificada como `provider_unavailable`,
`provider_rate_limit` ou `provider_quota`. Falhas `invalid_request`,
`invalid_output`, `output_truncated` e `config` não trocam de provider.

Ao trocar, o payload é **remontado** com o contrato do Groq (json_schema
estrito + `reasoningEffort`), e não reaproveita o payload de tool calling do
Gemini — é isso que faz o fallback falhar deterministicamente por motivo
diferente do erro original.

## 8. Retry / backoff / circuit breaker

- **Retry no mesmo candidato: não existe** no interpret do briefing. Cada
  candidato é chamado uma única vez (`for` sobre `candidates`, sem laço de
  tentativas). Compare com `runPlanAgent` (`monthly-plan-agent.server.ts`), que
  tem `MAX_ATTEMPTS = 3`, `SPACING_MS = 4000` e `BACKOFF_MS = [15s, 45s]` — essa
  lógica **não** foi aplicada ao briefing.
- **Backoff: nenhum.** A troca de candidato é imediata.
- **Circuit breaker: nenhum.** Não há estado persistido de provider degradado;
  cada execução repete a mesma cadeia mesmo depois de N falhas idênticas.
- Existe só um "auto-healing" de modelo: `isModelUnavailableError` +
  `nextFallbackModel` + `saveCatalogOverride` dentro de
  `withModelInstrumentation` — mas ele cobre modelo descontinuado/404, não 429,
  503 ou schema inválido.
- `salvageStructuredOutput` recupera JSON de `failed_generation` (Groq) — é
  mitigação de saída, não retry.

## 9. Timeout máximo do interpret

**Não existe timeout.** Nenhum `AbortSignal`, `AbortSignal.timeout` ou corrida
com `setTimeout` em `generateBriefingAnalysis` nem nas rotas. O único teto real
é o tempo de vida do isolate (`waitUntil`, `src/lib/wait-until.server.ts` — no
fallback Node é no-op de keep-alive). Histórico já registrou um `interpret` de
178.450 ms (~3 min). A UI faz polling a cada 2,5 s sem prazo de desistência, e
não há expiração de run: uma run `running` cujo isolate morra nunca recebe step
de falha e o modal fica em polling indefinido.

## 10. Registro do erro e retomada

Registro (bloco `catch` das duas rotas):

1. `setRunStep(..., "interpret", "failed", { error: technical, errorKind: "analysis" })`
   — mensagem técnica truncada em 2.000 chars, incluindo
   `Provider attempts: provider/model#n:kind (detail)`.
2. `client_documents.ai_status = "failed"` + `ai_error` amigável (500 chars) —
   só na rota de documento.
3. `failImportRun` → `briefing_import_runs.status = "failed"`, `error`,
   `error_kind`, `finished_at`.
4. Uso/custo por tentativa em `brand_ai_usage` (`recordAiUsage` dentro do
   wrapper de instrumentação), sucesso e falha.

Retomada: `retryImportRun` (`briefing-import.server.ts:759`) exige
`status = 'failed'`, volta para `queued` e incrementa `attempt` — transição
condicional, então é seguro contra corrida; `claimImportRun` faz o claim
`queued → running`. Limitações reais:

- retomada **sempre reprocessa do zero** (não retoma a partir de `ingest:done`;
  o step `ingest` é reexecutado);
- run travada em `running` **não é retryable** (nenhum job de expiração);
- a mensagem exibida vem de `friendlyAnalysisError`, que não cobre rate limit,
  TPM excedido nem provider indisponível — cai no genérico "Não foi possível
  analisar este material.".

## Estratégia de fallback provider-agnostic (proposta, não implementada)

1. **Descritor de capacidade por modelo** (uma tabela declarativa, sem
   hardcode espalhado): janela de contexto, TPM/RPM conhecidos, suporte a
   `json_schema` estrito, suporte a tool calling, suporte a
   `reasoningEffort`, suporte a entrada multimodal nativa. O interpret consulta
   esse descritor em vez de ramificar por `provider === "gemini"`.
2. **Orçamento de entrada calculado a partir do descritor**: estimar tokens do
   material e reduzi-lo (truncar por seções ou dividir em lotes com
   consolidação) para o candidato escolhido — antes do envio, nunca por
   caractere fixo.
3. **Uma única camada de adaptação de contrato**: função pura
   `buildInterpretCall(descriptor, payload)` que devolve o modo de saída (tool
   calling, json_schema estrito ou json permissivo) e só inclui parâmetros que
   o descritor declara suportados. Isso mata classes inteiras de HTTP 400.
4. **Política de tentativa uniforme**: por candidato, N tentativas com backoff
   exponencial + jitter apenas para falhas transitórias (429/5xx/quota);
   terminais (`invalid_request`, `invalid_output`, `config`) não repetem no mesmo
   contrato, mas podem **degradar o contrato** (estrito → permissivo → tool
   calling) antes de trocar de provider.
5. **Circuit breaker persistido por (provider, modelo)**: contador de falhas
   transitórias com janela de tempo; provider em aberto é despriorizado na
   ordenação de candidatos e reavaliado por meia-abertura. Reaproveitar o
   registro já existente em `ai_model_catalog_overrides` / health check.
6. **Timeout explícito e expiração de run**: `AbortSignal` por tentativa
   (orçamento por candidato, não pela cadeia inteira) e job que marca
   `running` mais antigo que N minutos como `failed` com
   `error_kind = "expired"`, liberando o retry.
7. **Retomada por passo**: persistir o material preparado do `ingest`
   (texto/ref de Storage) para que o retry comece em `interpret`, evitando
   redownload/reextração e cobrança dupla.
8. **Erros acionáveis**: mapear `provider_rate_limit`, `provider_quota`,
   `provider_unavailable` e material grande demais para mensagens pt-BR
   específicas em `friendlyAnalysisError`, com a ação sugerida (aguardar,
   reduzir material, configurar provider secundário).

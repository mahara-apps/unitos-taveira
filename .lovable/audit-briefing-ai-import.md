# Auditoria READ-ONLY — Importação e Geração de Briefing via IA

Data: 2026-08-29 · Escopo: somente leitura (código + catálogo Supabase). Nada foi alterado.

---

## 1. Resumo executivo

Hoje **não existe** uma funcionalidade "Importar Briefing" com IA. Existem três fluxos independentes:

| # | Fluxo | IA? | Onde |
|---|---|---|---|
| 1 | Botão **"Importar .docx / texto"** | ❌ Nenhuma | `briefing-workspace.tsx:450-458` — usa `window.prompt()` do navegador e apenas concatena o texto colado no campo **Posicionamento**. Não lê arquivo, não faz parsing, não chama servidor. |
| 2 | **Documentos & Contexto** (upload + "Analisar com IA") | ✅ Sim, 1 chamada por documento | `documents-tab.tsx` → `POST /api/jobs/analyze-document` → `client_documents.ai_summary` → aplicação manual campo-a-campo no briefing |
| 3 | **"Gerar Inteligência com IA"** (pipeline 5 etapas) | ✅ Sim, 5 chamadas | `briefing-workspace.tsx:1580` → `POST /api/jobs/customer-pipeline` → briefing → voice → personas → cohorts → SWOT |

A IA atual **apenas extrai campos** de um único documento. Não cruza fontes, não detecta conflitos, não decide o que preservar. Toda a lógica de merge é código determinístico (allow-list + descarte de vazios) e a resolução de conflito é **humana**, via checkboxes Antes/Depois. Não há qualquer suporte a transcrições de reunião nem a identificação de interlocutores/papéis. Histórico existe parcialmente (`brand_briefing_versions`), mas sem vínculo com o documento, sem prompt, sem modelo confiável e sem contagem criado/atualizado/mantido/descartado.

---

## 2. Fluxo atual completo

### 2.1 Fluxo 1 — "Importar .docx / texto" (sem IA)

```
Botão (briefing-workspace.tsx:1546)
  → importFromText() (450)
     → window.prompt("Cole aqui o texto do briefing (ou conteúdo extraído de um .docx)...")
     → setForm({...form, positioning: form.positioning + "\n\n" + raw})
     → toast "Texto importado — revise antes de salvar"
  → usuário clica em Salvar → saveBrandHub → writeCanonicalBriefing (origin "manual")
```

Nenhum arquivo é lido: o rótulo ".docx" é **enganoso** — o usuário precisa extrair o texto fora do sistema e colar.

### 2.2 Fluxo 2 — Análise de documento por IA

```
documents-tab.tsx handleFiles (181-212)
  → valida 25 MB no cliente → fileToBase64 (66-71)
  → uploadClientDocument (brand-hub.functions.ts:523-560)
       → Storage bucket `brand-documents`, path `${brandId}/${clientId}/${ts}-${nome}`
       → INSERT client_documents
  → auto-chama analyzeDoc(id) para cada upload (206)
       → fetch POST /api/jobs/analyze-document, Bearer <JWT do usuário>
            → checa Bearer (180-183) → auth.getClaims (192) → guardClientScope (197)
            → UPDATE ai_status='queued'
            → waitUntil(runAnalysis) → responde 202 imediatamente
       runAnalysis (63-174):
            → ai_status='running'
            → SELECT storage_path/mime_type/name (escopo brand+client)
            → storage.download → Uint8Array → base64 (arquivo INTEIRO)
            → getBrandAiModelAdmin(brandId,"text","operational",{agent:"document.analyze"})
            → generateText + Output.object(AiSummarySchema) com o arquivo inline
            → ai_status='done', ai_summary, extracted_text, analyzed_at
            → em erro: ai_status='failed', ai_error (500 chars)
  → UI faz polling a cada 3s enquanto queued/running (147-151)
  → AiReadingDrawer (519-679): diff "Antes" (getBriefingSnapshot) x "Depois (sugerido)"
  → applyDocumentToBriefing (documents-ai.functions.ts:135-215)
       → ALLOWED_FIELDS allow-list, descarta null/vazio
       → writeCanonicalBriefing(origin:"document")
       → UPDATE client_documents.applied_to_briefing_at
```

### 2.3 Fluxo 3 — Pipeline de inteligência

`GenerateIntelligenceButton` (1347-1376) → confirma essenciais faltantes → `runStrategy` (353-383) → `POST /api/jobs/customer-pipeline`, uma requisição HTTP **por etapa** (`STEPS = ["briefing","voice","personas","cohorts","swot"]`) para evitar timeout do isolate. Etapa `briefing` grava em `clients.brand_hub` (origin `ai.pipeline`); as demais gravam em `brand_voice_cards`, `brand_personas`, `brand_cohorts`, `brand_swot` via `replaceActive`.

---

## 3. Arquivos envolvidos

- `src/components/brand-hub/briefing-workspace.tsx` — UI do briefing, `window.prompt`, botão de inteligência
- `src/components/brand-hub/documents-tab.tsx` — upload, análise, drawer de revisão Antes/Depois
- `src/components/brand-hub/briefing-request-panel.tsx`, `quick-onboarding-wizard.tsx` — coleta via portal/onboarding
- `src/routes/api/jobs/analyze-document.ts` — worker de leitura de documento
- `src/routes/api/jobs/customer-pipeline.ts` — pipeline de 5 etapas
- `src/lib/documents-ai.functions.ts` — listar, aplicar ao briefing, snapshot, visibilidade
- `src/lib/brand-hub.functions.ts` — upload/exclusão/URL assinada de documentos
- `src/lib/briefing-write.server.ts` — **única** porta de escrita canônica + auditoria
- `src/lib/briefing-source.server.ts` — leitura canônica + `briefingToPromptText`
- `src/lib/ai-provider.server.ts`, `src/lib/ai-models-catalog.server.ts`, `src/lib/ai-usage.server.ts` — provider BYOK, modelo, telemetria de custo
- `src/lib/http-scope.server.ts` — `guardClientScope`
- `src/lib/wait-until.server.ts` — processamento assíncrono

---

## 4. Componentes envolvidos

`BriefingWorkspace` / `StackedBrainLayout` / `GenerateIntelligenceButton` / `SectionCard` (briefing), `DocumentsTab` / `AiReadingDrawer` (documentos), `BriefingRequestPanel` (solicitação ao cliente), `QuickOnboardingWizard`.

---

## 5. Endpoints / functions envolvidos

| Tipo | Nome |
|---|---|
| API route | `POST /api/jobs/analyze-document` |
| API route | `POST /api/jobs/customer-pipeline` |
| Server fn | `uploadClientDocument`, `deleteClientDocument`, `getClientDocumentUrl` |
| Server fn | `listClientDocumentsAi`, `applyDocumentToBriefing`, `getBriefingSnapshot`, `setClientDocumentVisibility` |
| Server fn | `saveBrandHub` (salvar briefing manual) |
| Helper server | `writeCanonicalBriefing`, `loadCanonicalBriefing`, `getBrandAiModel(Admin)`, `recordAiUsage` |
| RPC/DB | `can_access_client`, `client_in_scope`, `storage_scope_allows`, `emit_brain_event` |

---

## 6. Processamento de arquivos

**Não existe nenhuma biblioteca de extração de texto no projeto.** O arquivo bruto é enviado em base64 ao modelo multimodal; a "leitura" é feita pelo LLM.

| Tipo | Aceito | Processado como | OCR | Observação |
|---|---|---|---|---|
| PDF | sim (sem `accept=`) | `{type:"file", data: base64, mediaType}` | não (depende do modelo) | interpretação 100% pelo LLM |
| DOCX | sim | idem | — | **suporte real depende do provider aceitar o mime**; não há `mammoth`/parser. Risco alto de falha silenciosa marcada como `ai_status=failed` |
| TXT / CSV / JSON | sim | idem, como `file` | — | não há parsing estruturado; CSV/JSON viram texto para o modelo |
| PNG/JPG/WEBP | sim | `{type:"image", image:"data:...;base64"}` | não explícito | leitura via visão do modelo, sem OCR dedicado |

- **Onde:** servidor (rota TanStack), nunca no browser.
- **Armazenamento:** permanente, bucket privado `brand-documents`, path `{brandId}/{clientId}/...`.
- **Conteúdo extraído:** persistido em `client_documents.extracted_text` e `ai_summary` (sobrescrito a cada reanálise).
- **Limites:** 25 MB por arquivo (cliente `documents-tab.tsx:186` e servidor `brand-hub.functions.ts:527`). **Sem limite de quantidade** de arquivos, **sem limite de tamanho do payload enviado à IA**, `extracted_text` limitado apenas por instrução de prompt (8000 chars).
- **Declarado x implementado:** o rótulo "Importar .docx / texto" no briefing **não implementa** leitura de `.docx` — é só um `prompt()` de texto. O uploader não declara tipos (`accept` ausente), então o usuário pode enviar formatos que o modelo rejeitará.

---

## 7. Prompts atuais

### 7.1 `analyze-document.ts` (hardcoded, fora de `agent_prompts`)

System (`:129`):
> "Você é um analista sênior de marca. Interprete o documento e devolva um JSON estrito em pt-BR, mapeando cada informação para os campos de briefing. Use null quando o campo não estiver claramente descrito. Nunca invente dados. Todos os textos devem ser objetivos e prontos para uso no briefing (sem introduções como 'o documento diz')."

User (`:131`): extrair texto principal (≤8000 chars), classificar `document_type`, resumo executivo ≤400 chars, mapear campos de `briefing`, atribuir `confidence` 0-1.

Schema Zod `AiSummarySchema` (`:28-50`): `document_type`, `executive_summary`, `extracted_text`, `briefing{description, mission, positioning, values, audience, pain_points, demographics, offer, differentials, objections, journey, desires, tone_text, hashtags[], goals}`, `confidence`.

### 7.2 `customer-pipeline.ts`

`P.briefing` (:434), `P.voice` (:436), `P.personas` (:438), `P.cohorts` (:440), `P.swot`, com schemas `BriefingSchema`/`VoiceSchema`/`PersonasSchema`/`CohortsSchema`/`SwotSchema` (:265-324). Parsing tolerante via `parseJsonLoose` (:327-341).

### 7.3 `agent_prompts`

A tabela existe e é usada por outros agentes (`agent-prompts.server.ts`, `post-agents.server.ts`, `monthly-plan-kanban.server.ts`), **mas nenhum prompt de briefing/documento é lido dela** — os prompts acima são literais no código, sem versionamento e sem override por marca.

---

## 8. Modelos / providers

- Resolução: `getBrandAiModel` / `getBrandAiModelAdmin` (`ai-provider.server.ts`) — **BYOK por marca** (`getBrandProviderKey`), papel `operational` (documento e etapa briefing) ou `strategic` (voice/personas/cohorts/swot).
- Fallback: `getBrandFallbackProviderKey` em falha transitória (`:483-488`).
- Telemetria: `withModelInstrumentation` → `recordAiUsage` grava em `brand_ai_usage` (modelo real, tokens, custo).
- **Inconsistência comprovada:** `client_documents.ai_model` é gravado hardcoded como `"google/gemini-2.5-flash"` (`analyze-document.ts:163`), independente do modelo realmente usado.
- Temperatura: não definida em nenhuma das chamadas de documento/pipeline (default do SDK). Retry: só no pipeline (`runJson`, backoff próprio, `maxRetries:0` no SDK + `withTimeout`); a análise de documento **não tem retry nem timeout explícito**.

---

## 9. Estrutura atual do briefing

Fonte canônica única: **`clients.brand_hub` (jsonb)**, com `briefing_status`, `briefing_status_at`, `briefing_status_by`. Toda escrita passa por `writeCanonicalBriefing`, que faz merge não-destrutivo (`skipEmpty=true`), recalcula completude, transiciona status e insere snapshot de auditoria. `brand_briefings` é **legado congelado** (19 linhas históricas).

Origens registradas: `manual | ai.briefing | ai.pipeline | ai.edit | document | portal`.

---

## 10. Tabelas relacionadas

| Tabela | Finalidade | Versionado | created_by/updated_by | origem | confiança | vínculo doc | vínculo execução IA |
|---|---|---|---|---|---|---|---|
| `clients` (`brand_hub`) | briefing canônico | via versions | `briefing_status_by` | — | não | não | não |
| `brand_briefing_versions` | auditoria append-only (`snapshot`, `completion`, `status`, `origin`, `changed_fields[]`, `changed_by`) | sim | `changed_by` | sim (tabela) | não | **não** | **não** |
| `brand_briefings` | legado | não | — | — | — | — | — |
| `brand_briefing_requests / _proposals / _reviews` | solicitação/proposta/revisão de briefing | — | — | — | — | — | — |
| `client_documents` | documentos + resultado da IA (`ai_status`, `ai_model`, `ai_error`, `extracted_text`, `ai_summary`, `analyzed_at`, `applied_to_briefing_at`, `visible_to_client`) | **não** (sobrescreve) | `uploaded_by` | — | dentro de `ai_summary.confidence` | — | não |
| `brand_personas / _voice_cards / _swot / _cohorts / _competitors` | artefatos derivados | `replaceActive` | — | — | — | — | — |
| `brand_ai_content / brand_ai_versions` | conteúdo IA versionado (não é briefing) | sim | — | — | — | — | — |
| `brand_ai_usage` | ledger de custo (modelo, tokens, custo, actor_id) | append | `actor_id` | — | — | não | parcial |
| `ai_jobs` | jobs assíncronos genéricos | — | `user_id` | — | — | — | **não usado pela análise de documento** |
| `client_briefings / client_briefing_tokens` | briefing via portal | — | — | — | — | — | — |

---

## 11. Histórico / versionamento existente

| Pergunta | Hoje |
|---|---|
| Quando a IA rodou | ✅ `client_documents.analyzed_at`, `brand_ai_usage.created_at` |
| Quem executou | ⚠️ `brand_ai_usage.actor_id` existe, mas a análise de documento **não passa `userId`** → fica NULL |
| Qual arquivo foi usado | ❌ o documento é identificável, mas **não há FK** ligando-o à versão do briefing |
| Qual origem | ✅ `brand_briefing_versions.origin` (nível de operação, não de campo) |
| Qual modelo | ⚠️ ledger correto; `client_documents.ai_model` hardcoded/incorreto |
| Qual prompt | ❌ nunca persistido |
| Briefing anterior | ✅ derivável do snapshot da versão anterior |
| O que foi criado/atualizado/mantido/descartado | ⚠️ só `changed_fields[]` (lista plana); sem par antes/depois, sem contagens, sem "removido" (impossível por `skipEmpty=true`) |
| Detalhe da execução | ❌ inexistente |

**Não existe** tela ou tabela de "histórico de importações".

---

## 12. Integração com Brain

- Triggers reais: `brain_clients_evt` (AFTER INSERT/UPDATE em `clients`) e `brain_client_docs_evt` (**AFTER INSERT apenas** em `client_documents`).
- `brain_trg_client_documents()` emite `file.uploaded` com payload apenas `{file_name}` — **não dispara na conclusão da análise**.
- `brain_trg_clients()` emite `customer.updated` com payload apenas `{name}` — a alteração de briefing vira um evento vazio de conteúdo.
- **Nenhum código de `analyze-document.ts`, `documents-ai.functions.ts` ou `briefing-write.server.ts` toca `brain_memory`, `brain_embeddings`, `brain_insights`, `brain_relationships` ou `brain_recommendations`.**
- Nenhum trigger em `brand_briefing_versions`.

Conclusão: **a geração/importação de briefing NÃO usa o Brain**. Pontos naturais de integração futura: conclusão da análise (evento rico com diff), gravação de fatos em `brain_memory` com escopo cliente, chunks em `brain_embeddings` para cruzamento semântico, e `brain_relationships` para pessoas/papéis.

---

## 13. Processamento de transcrições

**Inexistente.** Busca por `transcri|speaker|interlocutor|diariz|reunião|meeting` em `src` retorna apenas ocorrências não relacionadas (placeholder de calendário). Não há: ingestão de transcrição, separação de falas, identificação de participantes, extração de decisões/dores/objeções, nem qualquer prompt que trate conversa multi-participante. Uma transcrição hoje só poderia ser enviada como TXT ao `analyze-document`, que a trataria como documento genérico e tentaria mapear campos de briefing.

Estruturas reutilizáveis já existentes: `brain_events`, `brain_memory`, `brain_embeddings`, `brain_relationships`.

---

## 14. Segurança / RBAC / RLS

- `/api/jobs/analyze-document`: exige Bearer JWT, valida claims e chama `guardClientScope` (RPC `can_access_client`) **antes** de baixar o arquivo — falha fechada.
- `runAnalysis` usa o **JWT do usuário** (`buildUserClient`), não service_role → RLS de `client_documents` (`client_in_scope`) e do Storage se aplicam.
- `supabaseAdmin` é usado apenas para credenciais do provider (`getBrandProviderKey`), orçamento e ledger `brand_ai_usage` — nunca para ler briefing ou documento.
- Bucket `brand-documents` privado; `storage_scope_allows()` valida `{brand_id}/{client_id}` do path contra `clients.brand_id`, permite portal só com `visible_to_client=true`. URLs assinadas com TTL de 5 min.
- Escrita revalida `brand_id` + `client_id` além da RLS (`briefing-write.server.ts:64-69,106-110`).
- **Vazamento entre clientes/marcas: não encontrado.** O prompt é construído só com o documento único e instruções fixas; nenhum path mistura contextos. Ressalva legítima: o arquivo trafega para o provider externo usando a chave BYOK da própria marca.
- **Gap comprovado (não é vazamento):** INSERT em `brand_briefing_versions` está restrito a `super_admin/admin/manager`, mas usuários com papel `user` podem atualizar `clients.brand_hub`. Nesses casos a auditoria falha silenciosamente (apenas `console.error`), gerando alteração sem rastro.

---

## 15. Performance / custos

- **1 chamada de IA por documento**; 5 chamadas por execução do pipeline.
- **Arquivo inteiro em base64 dentro do prompt**, sem truncamento e sem teto de payload — o limite de 25 MB é de upload, não de envio à IA.
- Sem chunking, sem embeddings, sem cache: reanalisar o mesmo arquivo repete todo o custo.
- Assíncrono via `waitUntil` + polling de 3s.
- Sem retry e sem timeout explícito na análise de documento; falha → `ai_status='failed'` sem re-enfileiramento.
- **Race comprovada:** o `UPDATE ai_status='running'` não é condicional (`.eq("ai_status","queued")` ausente); duplo clique ou múltiplos cliques disparam duas análises pagas simultâneas que se sobrescrevem.
- `brand_ai_usage.actor_id` NULL na análise de documento (userId não é propagado).

---

## 16. Problemas encontrados

1. "Importar .docx / texto" é `window.prompt()` — rótulo enganoso, sem leitura de arquivo, sem IA, e joga tudo em um único campo.
2. Nenhuma biblioteca de extração; DOCX/CSV/JSON dependem inteiramente do provider e podem falhar silenciosamente.
3. Uploader sem `accept=` e sem limite de quantidade.
4. `client_documents.ai_model` hardcoded → histórico de modelo incorreto.
5. Prompts de briefing/documento hardcoded, fora de `agent_prompts`, sem versionamento nem override por marca.
6. Nenhuma rastreabilidade documento → execução de IA → versão do briefing.
7. Prompt nunca persistido; parâmetros (temperatura, tentativas) não registrados.
8. `changed_fields[]` não distingue criado/atualizado/mantido/descartado e não representa remoção.
9. Auditoria pode falhar em silêncio para papel `user`.
10. Sem retry/timeout/idempotência na análise; risco real de custo duplicado.
11. Sem chunking/cache; documentos grandes ampliam custo e risco de timeout.
12. Brain praticamente desconectado do briefing (eventos sem conteúdo, nada na conclusão da análise).
13. Zero suporte a transcrição/participantes/papéis.
14. Reanálise sobrescreve `ai_summary` sem histórico do resultado anterior.

---

## 17. O que pode ser reaproveitado

**A. Já existe e pode ser reutilizado como está**
- `writeCanonicalBriefing` (merge não destrutivo + `origin` + snapshot) e `loadCanonicalBriefing`/`briefingToPromptText`.
- Upload + bucket `brand-documents` com `storage_scope_allows` e URL assinada.
- `guardClientScope` e o padrão de rota com Bearer + escopo.
- `getBrandAiModelAdmin` (BYOK, papéis, fallback) e `recordAiUsage`.
- `waitUntil` + polling por `ai_status`.
- `AiReadingDrawer` como base do painel de revisão Antes/Depois.
- `runJson` do pipeline (retry com backoff, timeout, classificação de erro).

**B. Existe mas precisa ser adaptado**
- `AiSummarySchema` → precisa virar um schema de *proposta de alteração* (por campo: valor, ação, confiança, evidência).
- `applyDocumentToBriefing` → hoje aplica lista de campos; precisa aplicar um conjunto de decisões.
- `brand_briefing_versions` → precisa de `document_id`, `ai_run_id`, contagens e diff por campo.
- `client_documents` → precisa de histórico de análises em vez de sobrescrita.
- Triggers Brain de `clients`/`client_documents` → payload rico e disparo na conclusão.

**C. Existe mas está errado/frágil**
- `importFromText` (`window.prompt`).
- `ai_model` hardcoded.
- `ai_status` sem idempotência.
- INSERT de auditoria bloqueado para papel `user`.
- Prompts fora de `agent_prompts`.

**D. Não existe e precisará ser criado**
- Modal real de importação com upload múltiplo, tipos declarados, colar texto e modo transcrição.
- Etapa de raciocínio de reconciliação (novo × conflito × desatualizado × manter).
- Tabela de execuções de importação + histórico navegável.
- Extração/normalização determinística por tipo (CSV/JSON/TXT) e chunking para documentos grandes.
- Interpretação de transcrição com identificação de participantes e papéis.
- Vetorização/cruzamento semântico com o Brain.
- Idempotência, fila e cache por hash de arquivo.

---

## 18. O que precisa ser criado (resumo)

Camada de importação (upload multi-arquivo + colar + transcrição) → extração normalizada por tipo → análise IA por documento → **etapa de reconciliação contra o briefing atual** → proposta revisável → aplicação transacional → registro de execução com métricas e diff → emissão de evento Brain rico.

---

## 19. Lacunas arquiteturais

1. **Ausência de uma entidade "execução de importação"** — sem ela nenhum histórico útil é possível.
2. **Ausência de proposta de alteração como dado** — hoje a sugestão da IA e a decisão do usuário não são persistidas, só o resultado final.
3. **Ausência de granularidade por campo** — origem, confiança, evidência e autor são de operação, não de campo.
4. **Extração acoplada ao provider** — sem camada própria de parsing, a compatibilidade de formatos é imprevisível.
5. **Briefing isolado do Brain** — o conhecimento extraído não alimenta memória/embeddings, impossibilitando cruzamento incremental.
6. **Sem modelo de identidades/papéis** — não há onde registrar pessoas mencionadas e seus papéis.
7. **Sem controle de concorrência/custo** por documento.

---

## 20. Fluxo recomendado para a futura funcionalidade (descritivo, não implementado)

```
IMPORTAR BRIEFING
   ↓  modal único: [Enviar arquivos] [Colar texto] [Transcrição de reunião]
UPLOAD / COLAR / TRANSCRIÇÃO
   ↓  arquivos → bucket brand-documents (escopo {brand}/{client}); hash de conteúdo para dedupe/cache
   ↓  cria 1 registro de EXECUÇÃO (status=queued) vinculado a usuário, brand, client, itens e tipo de importação
LEITURA DO DOCUMENTO
   ↓  normalização por tipo: TXT/CSV/JSON parseados deterministicamente; PDF/DOCX/imagem via modelo multimodal
   ↓  chunking por tamanho, com mapa de trechos (para evidência e citação)
INTERPRETAÇÃO PELA IA
   ↓  etapa 1: extração estruturada por chunk (campos + entidades + pessoas/papéis + decisões)
   ↓  em transcrição: segmentação por falante, atribuição de papel (cliente/gestor/agência/fornecedor/…)
CRUZAMENTO COM CONTEXTO EXISTENTE
   ↓  etapa 2 (reconciliação): recebe briefing canônico atual + extração consolidada
   ↓  para cada campo devolve {ação: criar|atualizar|manter|descartar, valor, confiança, evidência, motivo}
IDENTIFICAÇÃO DE NOVAS INFORMAÇÕES / CONFLITOS
   ↓  conflito = valor divergente com confiança alta em ambos os lados → marcado para decisão humana
PROPOSTA DE ALTERAÇÕES
   ↓  persistida (não só em memória) e revisável campo a campo, com Antes/Depois e trecho de origem
APLICAÇÃO
   ↓  writeCanonicalBriefing em transação lógica, origin "ai.import", carregando execution_id + document_id
   ↓  contagens gravadas: criados / atualizados / mantidos / descartados
HISTÓRICO DA GERAÇÃO
   ↓  lista: data/hora · usuário · arquivo(s) · tipo · origem · tipo de importação · modelo · status · resumo · contagens
   ↓  detalhe: proposta completa, decisões do usuário, diff aplicado, prompt e parâmetros usados
   ↓  emissão de evento Brain rico + gravação em brain_memory/brain_embeddings para importações futuras
```

Requisitos transversais recomendados: prompts migrados para `agent_prompts` com override por marca; idempotência por `(document_id, content_hash)`; retry com backoff e timeout explícitos; `userId` propagado ao ledger de custo; permissão de INSERT de auditoria alinhada aos papéis que podem editar briefing.

---

## Encerramento

- **Arquivos analisados:** ~20 (listados na seção 3), além de `types.ts` e componentes de portal/onboarding.
- **Tabelas analisadas:** `clients`, `brand_briefings`, `brand_briefing_versions`, `brand_briefing_requests`, `brand_briefing_proposals`, `brand_briefing_reviews`, `brand_personas`, `brand_voice_cards`, `brand_swot`, `brand_cohorts`, `brand_competitors`, `brand_pautas`, `brand_ai_content`, `brand_ai_versions`, `brand_ai_usage`, `ai_jobs`, `client_documents`, `client_briefings`, `client_briefing_tokens`, tabelas `brain_*`, `agent_prompts`.
- **Funções/endpoints analisados:** listados na seção 5, mais triggers `brain_trg_clients`, `brain_trg_client_documents` e função `storage_scope_allows`.
- **Prompts encontrados:** 1 (documento) + 5 (pipeline), todos hardcoded.

# Investigação READ-ONLY — erros de upload/processamento/leitura no Onboarding Rápido

Nada foi alterado. Base: código + histórico real de `briefing_import_runs` /
`briefing_import_steps` (últimas 11 execuções).

## 1. Causa provável (com evidência)

**Nenhuma das falhas está em upload, Storage ou leitura do arquivo. 100% das
falhas ocorreram no passo `interpret` (chamada de IA), sempre com
`ingest:done`.** Trilha de steps de todas as runs falhas:
`ingest:done > interpret:failed`.

A causa raiz é a **cadeia de providers BYOK operacional** — Gemini indisponível
(503) e o fallback Groq rejeitando a requisição por três motivos distintos:

| # | Erro real gravado em `briefing_import_steps.error` | Origem no código |
| --- | --- | --- |
| A | `invalid JSON schema for response_format: ... The following properties must be listed in 'required': confidence, evidence, speakers` | `strictJsonSchema: true` em `src/lib/briefing-generation.server.ts:12` + campos não-`required` em `src/lib/briefing-analysis-schema.ts` |
| B | `` `reasoning_effort` must be one of `low`, `medium`, or `high` `` | `reasoningEffort: "low"` é enviado, mas o modelo Groq selecionado (`llama-3.3-70b-versatile`) **não aceita o campo** — `briefingProviderOptions("groq")` aplica a opção a todo modelo Groq indistintamente |
| C | `Request too large for model 'openai/gpt-oss-20b' ... tokens per minute (TPM): Limit 8000, Requested 25841` | material de ~26k tokens contra teto de 8.000 TPM do tier Groq; nenhum controle de tamanho por provider antes do envio |
| D | `Failed to validate JSON / Failed to generate JSON ... see failed_generation` | saída estruturada; o salvage (`salvageStructuredOutput`) não recuperou |

Em todas essas execuções o `provider_attempts` mostra primeiro
`gemini/gemini-flash-latest#1:provider_unavailable (503 UNAVAILABLE)` — ou seja,
**o caminho feliz depende de o Gemini estar disponível**; quando ele cai, o
fallback Groq falha deterministicamente por A/B/C (não é transitório).

As duas runs que deram certo (30/08 03:08 e 31/08 14:20) foram justamente as em
que o Gemini respondeu (`gemini-flash-latest`, `status = applied`).

## 2. Timeouts e payloads grandes

- Uma run consumiu **178.450 ms (~3 min)** no `interpret` antes de falhar por
  rate limit (`a5933219…`). Não existe `AbortSignal`/timeout na chamada de IA
  (`generateBriefingAnalysis`, `src/lib/briefing-ai-executor.server.ts`), então o
  usuário fica em polling de 2,5 s (`briefing-import-dialog.tsx:141`) por minutos.
- Não há **expiração de run**: uma run em `running` cujo isolate morra
  (`waitUntil` cai para no-op fora do Worker, `src/lib/wait-until.server.ts:25`)
  nunca recebe step de falha → modal em polling infinito.
- **Payload grande no cliente**: PDF/imagem de até 25 MB é convertido em Base64
  no navegador (`briefing-import-dialog.tsx:88` + `:281`) e enviado como JSON
  (~33 MB) para a server fn `uploadClientDocument`
  (`src/lib/brand-hub.functions.ts:523-534`). Esse é o único ponto real de
  travamento por tamanho — e ele **nunca foi exercitado em produção**: não existe
  nenhuma run com `source_kind = 'document'` no histórico.
- **Payload grande na IA**: texto extraído é cortado em 60.000 chars no navegador
  (`briefing-import-extract.ts:56`) e 120.000 no servidor
  (`document-extract.server.ts:109`) — ambos muito acima do teto de 8.000 TPM do
  Groq, o que produz o erro C.

## 3. Storage e arquivos inválidos

- `storage.buckets`: `brand-documents` é privado e **sem `file_size_limit`** —
  o Storage não rejeita nada; o único limite é o `25 MB` em código
  (`brand-hub.functions.ts:527` e `briefing-import-ui.ts:21`).
- Nenhum erro de Storage/RLS aparece no histórico: `download` do bucket sempre
  concluiu (`ingest:done` com `bytes`/`mediaType` no output do step).
- Arquivos inválidos são barrados **antes** do envio (`validateImportFile`,
  `briefing-import-ui.ts:81-100`): `.doc` legado, extensão não suportada, vazio,
  >25 MB. `.doc` também é rejeitado no servidor
  (`document-extract.server.ts:172`). Nada disso aparece como falha registrada.
- Não existe Edge Function neste fluxo — são server routes TanStack
  (`/api/jobs/analyze-document`, `/api/jobs/analyze-briefing-text`); portanto não
  há erro de Edge Function a investigar.

## 4. Por que o usuário vê mensagem inútil

`friendlyAnalysisError` (`briefing-import-ui.ts:360+`) não cobre nenhum dos
erros reais A/B/C: eles caem no genérico
**"Não foi possível analisar este material."** (6 das 9 falhas) ou em
"não conseguiu organizar a análise" — sem indicar rate limit, provider caído ou
material grande demais. O detalhe técnico só existe no step.

## 5. Ordem de correção sugerida (não aplicada)

1. `briefingProviderOptions`: enviar `reasoningEffort` só para modelos Groq que
   aceitam o campo, e desligar `strictJsonSchema` **ou** tornar todas as
   propriedades `required` (com `nullable`) no `BriefingAnalysisSchema` → mata A e B.
2. Orçamento de entrada por provider/modelo: truncar/dividir o material conforme
   o TPM do candidato antes do envio → mata C.
3. Timeout explícito (`AbortSignal`) na chamada de IA + expiração de run
   (`running` há mais de N minutos → `failed`), para o modal nunca ficar preso.
4. Mensagens específicas em `friendlyAnalysisError` para rate limit, provider
   indisponível e material grande.
5. Caminho nativo (PDF/imagem): substituir o Base64 no cliente por upload direto
   ao Storage (signed upload URL) e persistir também os DOCX/planilhas hoje
   extraídos só no navegador.

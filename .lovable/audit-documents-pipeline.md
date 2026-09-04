# Auditoria técnica — Pipeline de documentos/arquivos (MASTER)

Escopo: leitura + execução real no workspace Pitada Digital (cliente de teste). Nenhum arquivo do projeto foi alterado. Dados de teste (9 documentos + 9 runs + objetos no bucket) foram removidos ao final.

## Fluxo real observado

upload (`uploadClientDocument`) → bucket `brand-documents` (`brand/client/timestamp-nome`) → linha em `client_documents` (`ai_status=idle`) → `POST /api/jobs/analyze-document` (fingerprint = idempotência) → run em `briefing_import_runs` com steps `ingest → interpret → diff → propose` → `briefing_import_changes` (15 campos) → revisão manual → `apply` grava briefing.

Provider real: **Gemini via BYOK do workspace**, modelo `gemini-flash-latest` (registrado em `provider_attempts`, ex.: `gemini/gemini-flash-latest#1:success`).

## Resultados por cenário

| Cenário | Ingest | IA | Propostas | Resultado |
|---|---|---|---|---|
| PDF (23 KB) | inline multimodal | ok | 15 campos / 6 com valor | PASS |
| DOCX (`sourceKind=document`) | texto extraído (mammoth), 166 chars | ok | 15 / 2 | PASS |
| DOCX marcado como **transcrição** | `empty_input_text` | não executou | 0 | **FAIL** |
| XLSX | texto extraído (xlsx) | ok | 15 / 1 | PASS |
| CSV | texto direto | ok | 15 / 1 | PASS |
| TXT | texto direto | ok | 15 / 3 | PASS |
| Imagem PNG | inline multimodal | ok | 15 / 4 | PASS |
| PDF corrompido (512 B) | ingest "done" | Gemini 400 `invalid argument`, 3 tentativas | 0 | **FAIL** |
| TXT grande (6 MB) | lido, **clipado em 120.021 chars** | ok | 15 / 0 com valor | RISCO |
| Arquivo > limite | rejeitado `document_too_large` | — | — | PASS (com ressalva) |
| 8 arquivos em sequência | todos 200/202 | 7 runs `proposed` | — | PASS |
| Persistência / refresh | bucket ↔ banco 1:1 (bytes idênticos), runs e changes persistidos | — | — | PASS |

## Falhas confirmadas

1. **FAIL crítico — arquivos classificados como "Transcrição de reunião" nunca são lidos.**
   `inferSourceKind` (src/lib/briefing-import-ui.ts) marca como `transcript` qualquer nome contendo `transcri`, `reuniao/reunião`, `meeting`, `call`, `ata`, `gravacao`, `.vtt`, `.srt` — e o usuário também pode escolher isso no seletor do modal. O executor só baixa o arquivo do bucket quando `source_kind === "document"`; com `transcript` ele espera `raw_text` e falha em `ingest` com `empty_input_text` → run em `needs_input`. Reprodução: o mesmo DOCX falhou como `transcript` e passou perfeitamente como `document`. **Esta é exatamente a causa das falhas relatadas com DOC/DOCX de transcrições de reunião.**

2. **FAIL — arquivo corrompido consome 3 chamadas de IA e deixa o documento preso.**
   Não há validação de assinatura/parse antes de enviar ao modelo; o erro do provider (`Request contains an invalid argument.`) é classificado como `analysis` (retryable). Após esgotar as tentativas a run termina em `expired`, mas `client_documents.ai_status` permanece `queued` e `ai_error` fica nulo — o reaper não reconcilia o documento (só o worker faz isso). Na tela o arquivo aparece "em fila" para sempre.

## Riscos

- **Truncagem silenciosa em 120k caracteres**: o TXT de 6 MB foi cortado sem qualquer aviso ao usuário; a análise devolveu 15 campos sem valor útil e o run ficou `proposed` (aparência de sucesso).
- **Limite de tamanho baseado em `sizeBytes` declarado pelo cliente**, não no conteúdo decodificado no servidor.
- Mensagens de erro do provider chegam cruas ao registro da run (texto técnico em inglês).

## Recomendações (ordem)

1. Fazer o executor baixar o arquivo do bucket sempre que houver `document_id`, independentemente de `source_kind` (usar `source_kind` apenas como dica de prompt).
2. Reconciliar `client_documents.ai_status/ai_error` também no reaper (estados `expired`/`failed`).
3. Validar o arquivo antes da IA (magic bytes / parse) e classificar falha de parse como `input` (não-retryable), com mensagem em pt-BR.
4. Sinalizar truncagem no step `ingest` e exibir aviso na revisão.
5. Recalcular o tamanho a partir do conteúdo decodificado no servidor.

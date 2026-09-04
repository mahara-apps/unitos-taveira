# Auditoria READ-ONLY — Onboarding Rápido com envio de documento

Escopo: caminho completo do usuário quando, dentro do **Onboarding Rápido**, ele
usa "Gerar com IA" e envia um documento. Nenhuma linha de código foi alterada.

## 1. Mapa do fluxo (ponta a ponta)

```text
[Onboarding Rápido]  src/components/brand-hub/quick-onboarding-wizard.tsx
   botão "Gerar com IA" → setAiOpen(true)
   renderiza <BriefingImportDialog embedded sourceLabel="Onboarding Rápido" />
        │
[Modal de importação]  src/components/brand-hub/briefing-import-dialog.tsx
   valida arquivo         → src/lib/briefing-import-ui.ts (validateImportFile / fileHandling)
   decide o caminho:
     handling = "extract"  (docx, xlsx, xls, csv, txt, md, json, vtt, srt)
        → extração NO NAVEGADOR: src/lib/briefing-import-extract.ts
          (mammoth.browser / xlsx / file.text(), corte em 60.000 chars)
        → composeTextMaterial() junta texto colado + arquivos num único bloco
        → POST /api/jobs/analyze-briefing-text (Bearer do supabase.auth)
     handling = "native"   (pdf, png, jpg, jpeg, webp)
        → fileToBase64() no navegador
        → uploadClientDocument (server fn, src/lib/brand-hub.functions.ts:523)
             ├ limite 25 MB
             ├ storage.upload → bucket `brand-documents`
             │   path `${brandId}/${clientId}/${Date.now()}-${nome_sanitizado}`
             └ INSERT em `client_documents`
        → POST /api/jobs/analyze-document { documentId }
        │
[Rota de job]  src/routes/api/jobs/analyze-document.ts  |  analyze-briefing-text.ts
   1. exige `Authorization: Bearer <jwt 3 partes>`
   2. Zod no body; client Supabase do usuário (RLS ativa)
   3. getClaims → fallback getUser  → userId
   4. guardClientScope() → RPC can_access_client (src/lib/http-scope.server.ts)
   5. (documento) lê metadados de client_documents → 404 se não existir
   6. buildInputFingerprint() → startImportRun() (idempotência / reuso)
      reuso e run viva → 200 { reused: true }, sem gasto de IA
   7. waitUntil(runAnalysis(...)) → responde 202 { runId }
        │
[Trabalho em background]  waitUntil (src/lib/wait-until.server.ts)
   claimImportRun (queued→running, trava de concorrência)
   ingest:    download do storage → prepareDocumentContent
              (src/lib/document-extract.server.ts)
              pdf/imagem → inline Base64 + assertInlinePayload
              docx → mammoth | planilha → xlsx | texto → TextDecoder
              corte em 120.000 chars; .doc legado e binário → erro claro
   interpret: generateBriefingAnalysis (src/lib/briefing-ai-executor.server.ts)
              BYOK do workspace via getBrandAiCandidatesAdmin (operational)
              gemini → tool calling forçado; outros → Output.object
              salvage de saída + fallback só para 429/5xx/quota
   diff:      loadCanonicalBriefing → classifyChange campo a campo
   propose:   saveImportProposal → status `proposed` + briefing_import_changes
        │
[Revisão e aplicação]
   polling getBriefingImportRun (2,5 s) → revisão campo a campo no modal
   applyBriefingImportRun → applyImportRun → writeCanonicalBriefing (versão + Brain event)
   onApplied → wizard faz hubQ.refetch() e re-semeia o formulário
```

Rotas/endpoints envolvidos (não há Edge Function neste fluxo):

| Endpoint | Papel |
| --- | --- |
| server fn `uploadClientDocument` | upload no bucket + registro em `client_documents` |
| `POST /api/jobs/analyze-briefing-text` | material textual (colado, docx, planilha, legenda) |
| `POST /api/jobs/analyze-document` | PDF/imagem (multimodal) |
| server fn `getBriefingImportRun` | polling de status/steps/changes |
| server fn `applyBriefingImportRun` | aplicação idempotente dos campos aceitos |
| `POST /api/jobs/customer-pipeline` | passo final do wizard ("Gerar Inteligência"), fora da importação |

## 2. Evidência do estado atual (execuções reais)

Últimas 11 runs em `briefing_import_runs`: **todas** com `source_kind = transcript`
(caminho textual). As duas mais recentes (30/08 03:08 e 31/08 14:20) chegaram a
`applied` com `gemini-flash-latest`. As anteriores falharam em `interpret`
(`error_kind = analysis`), com mensagens de rate limit, "não conseguiu organizar
a análise" e a genérica "Não foi possível analisar este material".

Conclusão factual: o caminho **nativo (PDF/imagem) nunca aparece no histórico** —
não há nenhuma run com `source_kind = document`. O fluxo hoje exercitado no
onboarding é o textual.

## 3. Pontos de falha identificados

### Alto risco

1. **Falhas concentradas em `interpret`, não na leitura.** O padrão histórico é
   ingest concluído + provider recusando/limitando. Duas runs registram
   `provider = null`, isto é, falharam antes de qualquer candidato responder
   (provider não configurado ou rate limit na seleção) — o usuário recebe
   mensagem genérica.
2. **Trabalho em background dependente do isolate.** `waitUntil` cai para
   "no-op keep-alive" quando não há `h3Event` (dev/Node). Se o isolate encerrar
   após o 202, a run fica presa em `running` sem step de falha, e o modal segue
   em polling indefinido — não existe timeout/expiração de run.
3. **Extração de DOCX/planilha ocorre no navegador** (`briefing-import-extract.ts`,
   limite 60.000 chars) enquanto o servidor tem lógica equivalente e mais
   completa (`document-extract.server.ts`, 120.000 chars, mais formatos). Duas
   fontes de verdade: arquivo grande é cortado de forma diferente conforme o
   caminho, e o arquivo original de docx/planilha **não é persistido** em
   `client_documents` (sem rastro auditável do material recebido).
4. **`fileToBase64` no cliente para PDF/imagem de até 25 MB** carrega o arquivo
   inteiro em memória e o envia como JSON Base64 (~33 MB de payload) para uma
   server function. Em conexão fraca ou arquivo grande, isso é o principal
   candidato a travamento/erro opaco no onboarding.

### Médio risco

5. **Reuso por fingerprint confunde o usuário no onboarding.** Reenviar o mesmo
   material devolve `reused: true` com a run já aplicada; o modal mostra estado
   "applied" em vez de nova proposta. Só o retry explícito (`force`) gera nova
   análise.
6. **Fingerprint de documento inclui o timestamp do path** (o path tem
   `Date.now()`), portanto dois uploads do mesmo arquivo geram fingerprints
   diferentes e a idempotência real do caminho nativo é fraca — reanálise paga.
7. **Erro de upload aborta todo o lote.** No `start()`, uma falha de upload/POST
   em um dos arquivos lança e descarta as runs já criadas para os outros
   (`created` é perdido), embora elas continuem rodando no servidor.
8. **Perda de progresso do wizard.** `onApplied` faz `refetch` e re-semeia o
   state local, mas o passo em que o usuário estava não é reconciliado com o que
   a IA aplicou; campos editados e não salvos no passo atual são sobrescritos.
9. **Mensagens amigáveis mascaram a causa.** `friendlyAnalysisError` colapsa
   várias classes em "Não foi possível analisar este material"; a causa técnica
   fica só no step/log, sem link para o histórico dentro do modal embutido.

### Baixo risco / observações

10. `analyze-document.ts` lê `process.env.SUPABASE_URL` com acesso por
    propriedade, enquanto o irmão usa bracket notation — divergência de estilo
    sob `noPropertyAccessFromIndexSignature`, sem impacto funcional atual.
11. Autorização está consistente nos dois workers: bearer obrigatório,
    `guardClientScope` via `can_access_client`, RLS aplicada pelo client do
    usuário, e o documento só é lido com `brand_id` + `client_id` casando.
12. Nada é aplicado automaticamente: `saveImportProposal` para em `proposed` e a
    escrita só ocorre em `applyImportRun` com campos aceitos — comportamento
    correto e preservado no modo embutido do onboarding.
13. `.doc` legado é rejeitado com orientação; `assertInlinePayload` protege o
    contrato Base64 do provider antes da chamada.

## 4. Onde eu olharia primeiro, caso o usuário relate erro

1. `briefing_import_steps` da run: se `ingest = done` e `interpret = failed`, o
   arquivo foi lido — o problema é provider/schema, não o documento.
2. Runs paradas em `running` sem step de falha → suspeitar do encerramento do
   isolate (`waitUntil`).
3. Run com `provider = null` → configuração BYOK do workspace ou rate limit na
   seleção de candidatos.
4. Falha antes de qualquer run criada (erro só no modal, sem histórico) →
   upload Base64 / limite de 25 MB / extração no navegador.

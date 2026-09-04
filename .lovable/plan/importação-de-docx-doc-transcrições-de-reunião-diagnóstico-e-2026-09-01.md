# Importação de DOCX/DOC (transcrições de reunião) — diagnóstico e correção

## Status atual (verificado)

**O erro que aparece na tela não vem da IA.** Ele acontece no navegador, antes de qualquer chamada de IA:

```text
Failed to resolve module specifier 'mammoth/mammoth.browser.js'
```

Por isso não existe nenhuma execução registrada com falha de DOCX no banco: a análise nunca chega a ser criada, e a mensagem final vira "Nenhum material legível foi enviado."

Causa: no leitor de arquivos do navegador, a biblioteca de leitura de DOCX é importada por um caminho que o empacotador foi instruído a ignorar. Em produção/preview o navegador recebe esse nome de módulo "cru" e não consegue resolvê-lo. Ou seja: **todo DOCX enviado pelo modal falha 100% das vezes**, independentemente do conteúdo.

Ponto importante: **o servidor já sabe ler DOCX corretamente** (mesma biblioteca, rodando no backend, junto com planilhas, CSV, TXT, legendas, PDF e imagens). O caminho de servidor está pronto e é o usado quando o arquivo é PDF/imagem. Apenas os formatos "de escritório" foram roteados para o navegador — e é aí que quebram.

**.DOC (Word 97)** é bloqueado de propósito, em ambos os lados: é um formato binário legado que nenhuma biblioteca JS pura lê. Isso continua sendo uma limitação real; o que muda é a clareza da orientação ao usuário.

## Qual IA está atuando

Configuração real deste workspace (Pitada Digital):

- Provedor principal: **Gemini** — modelo `gemini-flash-latest`
- Provedor de fallback (só em falha transitória): **Groq**
- Sem Cloud AI / gateway Lovable, conforme a regra do projeto (BYOK por workspace)

Histórico das execuções: as últimas importações de transcrição e documento terminaram em **aplicado** com Gemini. As falhas antigas foram de limite de requisições do provedor e de resposta não estruturada — nenhuma relacionada a DOCX.

## Padrão de leitura e entendimento dos documentos

```text
arquivo → como é lido → o que a IA recebe
PDF, imagem      → enviado inteiro ao modelo   → conteúdo visual + texto (multimodal)
DOCX / ODT       → texto extraído              → texto puro do documento
XLSX/XLS/CSV     → uma seção por aba, em CSV    → texto tabular rotulado
TXT/MD/JSON/VTT/SRT → lido direto              → texto puro
DOC (Word 97)    → não suportado               → precisa converter para DOCX/PDF
```

Depois da leitura, a execução segue sempre as mesmas etapas: leitura → extração → interpretação pela IA → comparação com o briefing atual → proposta campo a campo → aplicação apenas do que o usuário aceitar. Transcrições recebem instrução extra para identificar participantes e papéis somente com evidência explícita. Limite defensivo de conteúdo por arquivo e prazo por etapa já existem, e a interpretação já concluída não é paga de novo em reprocessamentos.

## Correção proposta

1. **Mandar DOCX (e demais formatos de escritório/texto) pelo caminho do servidor**, exatamente como PDF e imagem já fazem: o arquivo sobe para o bucket e a extração acontece no backend, que já a implementa de forma robusta. Isso elimina a dependência frágil do navegador e o erro de módulo desaparece por remoção da causa, não por remendo.
2. **Remover o leitor de DOCX do navegador** desse fluxo, mantendo no cliente apenas o que é trivialmente legível lá (texto colado). Nenhuma regra de negócio, endpoint, tabela ou etapa de execução muda: o mesmo endpoint de análise de documento passa a receber também DOCX/planilhas/texto.
3. **Mensagem clara para .DOC**: manter o bloqueio, com orientação direta de salvar como .docx ou PDF (inclusive quando o Word/Teams gera .doc por padrão em transcrições antigas).
4. **Validação real ponta a ponta**: subir um DOCX de transcrição de reunião pelo modal e confirmar que a execução chega a "revisar alterações" com campos propostos, além de typecheck, build e a suíte de testes de importação.

## Detalhes técnicos

- `src/lib/briefing-import-ui.ts`: reclassificar `.docx/.xlsx/.xls/.csv/.txt/.md/.json/.vtt/.srt` de `extract` (navegador) para o caminho de upload + análise no servidor; `.doc` permanece rejeitado com mensagem orientativa.
- `src/components/brand-hub/briefing-import-dialog.tsx`: o laço de leitura no navegador deixa de existir para esses formatos — todos os arquivos válidos passam a seguir o mesmo fluxo de upload e `POST /api/jobs/analyze-document`, preservando o seletor Documento/Transcrição, o reuso por fingerprint e a revisão campo a campo.
- `src/lib/briefing-import-extract.ts`: deixa de importar `mammoth`/`xlsx` no bundle do cliente (a extração canônica fica em `document-extract.server.ts`); `composeTextMaterial` continua servindo o texto colado.
- Nada muda em `briefing-import-executor.server.ts`, `document-extract.server.ts`, migrations, RLS, crons, leases ou checkpoints.
- Sem alteração de provedor/modelo de IA.

## Fora do escopo

Conversão automática de .DOC para .DOCX no servidor (exigiria LibreOffice, indisponível no runtime serverless). Se isso for necessário, entra como decisão separada.

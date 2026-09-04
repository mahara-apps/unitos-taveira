# Correção final da Importação de Briefing via IA

## Diagnóstico confirmado

A execução mais recente (`a5593964-b7b4-4254-a8af-3cf7217439c7`, 30/08/2026 02:30 UTC) não falhou no upload nem na leitura do DOCX:

- o arquivo foi extraído corretamente como transcrição, com **16.643 caracteres**;
- o Gemini primário (`gemini-flash-latest`) respondeu **503 / alta demanda**;
- o fallback configurado mudou para Groq (`openai/gpt-oss-20b`);
- o schema portátil foi aceito, mas o Groq encerrou com `max completion tokens reached before generating a valid document`;
- a requisição não definia limite explícito de saída (`max_tokens: undefined`), e o modelo consumiu a saída antes de concluir o JSON;
- a interface agrupou esse caso específico junto aos erros genéricos de estruturação e mostrou “tente novamente em alguns instantes”.

Portanto, a falha atual é diferente do erro anterior de `required`: o contrato do schema já avançou, mas falta controlar o orçamento de saída do fallback e reduzir o volume da resposta estruturada.

## Implementação

### 1. Configuração de geração adequada ao provider

- Criar uma configuração compartilhada para as duas rotas de análise (`analyze-briefing-text` e `analyze-document`).
- Definir explicitamente um orçamento de saída suficiente para a análise completa.
- Para Groq/GPT-OSS, desativar ou reduzir o raciocínio interno que compete com os tokens do JSON e manter structured output estrito.
- Não aplicar `temperature` ou opções incompatíveis com o modelo.
- Manter apenas um fallback por indisponibilidade transitória do provider primário; respostas 400 continuam terminais e não entram em loop/reenvio automático.

### 2. Tornar a saída compacta e previsível

- Limitar no schema/prompt o tamanho de resumo, campos textuais, evidências e identificação de participantes.
- Gerar no máximo uma evidência objetiva por campo proposto.
- Não pedir ao modelo para repetir texto que já foi extraído pelo sistema; o conteúdo extraído continua preservado pela import run/documento.
- Para PDFs e imagens, manter a extração multimodal, mas limitar o texto retornado sem perder os campos, conflitos e participantes necessários à revisão.

### 3. Tratar truncamento separadamente

- Detectar explicitamente `max completion tokens reached` e classificá-lo como solicitação/saída excedida, não como indisponibilidade transitória.
- Preservar o erro técnico completo no step da execução e nos logs.
- Mostrar mensagem específica: a análise ficou maior que o limite do modelo, o material foi preservado e pode ser reprocessado após o ajuste.
- Não tentar salvar sentinelas de erro como se fossem JSON e não aplicar qualquer alteração automaticamente.

### 4. Preservar o fluxo existente

- Manter fingerprint, reutilização de run, concorrência, histórico, provider/model efetivos, proposta campo a campo e apply idempotente.
- Manter a revisão obrigatória dentro do modal; somente os campos confirmados pelo usuário serão aplicados.
- Não alterar banco, migrations, RBAC, RLS, autenticação, tenants/workspaces ou instalação.

## Validação

- Adicionar regressão usando o DOCX real da Use do Avesso.
- Simular a sequência real: Gemini 503 → Groq/GPT-OSS → JSON completo → run `proposed`.
- Cobrir truncamento do Groq, schema válido, salvage de JSON recuperável e mensagem amigável específica.
- Confirmar texto colado, DOCX/transcrição, PDF/imagem e múltiplos materiais sem regressão.
- Confirmar que nada é aplicado antes da revisão e que o apply permanece idempotente.
- Rodar typecheck, testes direcionados, suíte completa e build.
- Executar uma nova tentativa real pelo fluxo autenticado e confirmar no banco: `ingest=done`, `interpret=done`, run `proposed`, provider/model efetivos e abertura da revisão. Se a sessão autenticada continuar indisponível neste ambiente externo, registrar claramente essa única limitação e validar a próxima tentativa feita no preview pelos dados persistidos da run.

# Solução definitiva — Importação de Briefing por IA

## O que aprendemos com o pipeline NEXUS

O NEXUS confirma que o arquivo não é o problema: a estabilidade vem de separar claramente ingestão, contrato do provider, normalização e aplicação.

Aplicaremos estes princípios:

- cada provider recebe somente parâmetros e schema compatíveis com seu protocolo;
- saída estruturada não depende de um único objeto de opções reutilizado entre providers;
- schema enviado ao modelo é simples, sem `.min()`, `.max()`, `pattern`, `format` ou enums desnecessariamente rígidos;
- limites ficam no prompt e são aplicados novamente em código após a resposta;
- erros 4xx são terminais; apenas 429/5xx entram em retry/fallback limitado;
- texto extraído preserva parágrafos e informa truncamento/qualidade;
- valores ausentes nunca apagam dados existentes.

Não copiaremos os pontos incompatíveis com o Unitos: não criaremos Edge Function, não usaremos service role para aplicar briefing, não faremos atualização automática e não removeremos import runs, histórico, RBAC/RLS ou seleção BYOK do workspace.

## Diagnóstico confirmado no Unitos

A execução real mais recente (`feba8a36-8493-4b21-bc96-ee8c6e3547d5`) concluiu a ingestão e falhou somente em `interpret`:

1. Gemini `gemini-flash-latest` respondeu 503 por alta demanda.
2. O wrapper interno trocou para Groq `openai/gpt-oss-20b` mantendo o mesmo `providerOptions` da chamada.
3. O Groq recebeu `reasoning_effort: "none"`, embora GPT-OSS aceite apenas `low`, `medium` ou `high`, e respondeu HTTP 400.
4. As rotas usam `generateText + Output.object`, mas tratam `NoObjectGeneratedError`; nessa combinação o AI SDK lança `NoOutputGeneratedError`, fazendo falhas estruturadas escaparem para a mensagem genérica.
5. O schema atual ainda contém bounds (`.max()`, `.min()` e enum), aumentando a fragilidade entre dialetos de structured output.

Portanto, a causa arquitetural é o fallback ocorrer dentro do modelo, depois que a chamada já foi montada para outro provider. Apenas trocar `none` por `low` corrigiria o erro atual, mas manteria aberta a mesma classe de falhas.

## Implementação

### 1. Separar seleção de provider da execução estruturada

- Criar um executor específico de análise de briefing que receba os candidatos configurados do workspace em ordem: primário e, se habilitado, fallback.
- Executar cada tentativa separadamente; o fallback não reutilizará a requisição já montada para o provider anterior.
- Registrar em cada tentativa provider, modelo, resultado e causa, preservando o provider/model efetivamente bem-sucedido na import run.
- Manter o wrapper genérico atual para outros recursos; a mudança fica restrita à importação de briefing.

### 2. Usar contrato específico por provider

- **Gemini:** usar tool/function calling forçado pelo adapter Google, com schema normalizado para o dialeto aceito pelo Gemini e leitura dos argumentos da tool.
- **Groq/GPT-OSS:** usar structured output estrito do adapter Groq, com `reasoningEffort: "low"`, `strictJsonSchema: true` e orçamento explícito de 8.192 tokens.
- Nunca enviar opções Groq ao Gemini, nem opções Gemini ao Groq.
- Não introduzir Lovable AI/Cloud AI nem trocar as chaves BYOK configuradas no workspace.

### 3. Simplificar e normalizar o schema

- Manter todos os campos top-level obrigatórios; ausência semântica será `null` ou array vazio.
- Remover bounds do schema enviado aos providers e reduzir enums frágeis; regras de tamanho e papéis permitidos ficam no prompt e na normalização local.
- Após a resposta, validar tipos, limitar textos/arrays em código, normalizar metadados omitidos e transformar papel desconhecido em `indefinido` com revisão necessária.
- Não inventar participante, identidade, valor ou informação sem evidência.

### 4. Corrigir parsing e erros do AI SDK

- Tratar `NoOutputGeneratedError` nas duas rotas e no salvage; manter `NoObjectGeneratedError` somente como compatibilidade defensiva.
- Recuperar JSON parcial apenas quando houver objeto completo e validável; rejeitar JSON truncado, prosa ou sentinelas.
- Mapear separadamente: provider não configurado, indisponibilidade 503, rate limit 429, request inválido, schema incompatível, truncamento e ausência de saída.
- Manter o erro técnico integral nos logs/steps, mas mostrar ao usuário mensagem objetiva e acionável.

### 5. Consolidar ingestão sem alterar o fluxo funcional

- DOCX continua por extração textual, preservando parágrafos; XLS/XLSX/CSV por abas/estrutura; TXT/MD/JSON/VTT/SRT como texto; PDF e imagens pelo caminho multimodal já existente.
- Adicionar metadados de extração por arquivo: método, caracteres, qualidade e eventual truncamento.
- Definir orçamento total previsível para material combinado; quando excedido, dividir em blocos com merge determinístico ou informar claramente o corte — nunca truncar silenciosamente.
- Preservar detecção de transcrição, múltiplos arquivos e comparação com briefing atual.

### 6. Preservar revisão, segurança e idempotência

- A IA produz somente proposta; nada é aplicado automaticamente.
- Campos `null`, vazios ou não selecionados nunca sobrescrevem dados existentes.
- Manter fingerprint/reuso, claim de concorrência, retry explícito, histórico, revisão campo a campo e apply idempotente.
- Não alterar banco, migrations, RBAC, RLS, autenticação, tenants/workspaces, instalação ou separação Instalação × Workspace.

## Validação obrigatória

### Testes automatizados

- Provider-aware: Gemini não recebe opções Groq; GPT-OSS recebe somente `reasoningEffort: "low"`.
- Gemini 503 → fallback Groq com nova requisição compatível → proposta válida.
- HTTP 400 não faz retry/fallback; 429/5xx respeitam backoff e limite de tentativas.
- `NoOutputGeneratedError`, `NoObjectGeneratedError`, JSON recuperável, JSON truncado e ausência de saída.
- Schema sem bounds no wire e normalização/clamp pós-resposta.
- DOCX real da Use do Avesso, texto colado, transcrição, PDF, imagem, XLS/XLSX, CSV, TXT e múltiplos arquivos.
- Briefing vazio, preenchido, informações novas, repetidas e contraditórias.
- Idempotência da análise, clique concorrente, retry e aplicação manual idempotente.

### Prova real de conclusão

- Rodar typecheck, testes direcionados, suíte completa e build.
- Acionar nova importação pelo preview e acompanhar a nova run até estado terminal.
- Considerar resolvido somente quando a run chegar a `proposed`, com `ingest` e `interpret` concluídos, provider/model efetivos registrados e revisão campo a campo exibida.
- Aplicar somente campos selecionados e confirmar que o histórico permanece íntegro.

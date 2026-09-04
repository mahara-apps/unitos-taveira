# Corrigir falha do "Preencher/Importar com IA" no Briefing

## Diagnóstico confirmado (logs do servidor)

- O DOCX enviado ("Anotações do Gemini" — transcrição de reunião da Use do Avesso) **extrai corretamente** (16.553 chars via mammoth — testado com o arquivo real).
- A IA **gerou uma análise completa e correta** (resumo executivo, público, dores, objetivos, jornada, tom de voz...).
- A chamada foi **descartada pelo provider** com `json_validate_failed`: o schema estruturado exigia as propriedades `evidence`, `speakers` e `confidence` como obrigatórias, e o modelo não as incluiu no topo do JSON → erro → UI mostrou "Não foi possível interpretar o material."
- Ou seja: **bug de schema rígido demais**, não de upload, extração ou provider.

## Correções

### 1. Tornar a saída estruturada tolerante (causa raiz)
- Em `analyze-briefing-text.ts` (e `analyze-document.ts`, que usa o mesmo padrão): remover `evidence`, `speakers` e `confidence` da lista `required` do schema estruturado e aplicar **defaults em código** após o parse (`evidence: {}`, `speakers: []`, `confidence: 0.7` quando ausentes).
- Adicionar **salvaguarda de parse**: se o provider retornar `json_validate_failed` com `failed_generation`, tentar fazer `JSON.parse` do conteúdo gerado e aproveitar a análise em vez de falhar (a geração estava perfeita).
- Manter instrução no prompt pedindo esses campos, mas sem derrubar a execução quando vierem ausentes.

### 2. Mensagens de erro mais úteis
- Distinguir no UI: falha de schema/parse ("A IA respondeu em formato inesperado — tentando novamente...") vs. IA não configurada vs. arquivo ilegível. Erro técnico completo continua nos logs da import run.

### 3. Alinhamentos pontuais com o pipeline de referência (NEXUS)
Já implementados aqui: extração client-side de DOCX/XLS/CSV/TXT, multimodal para PDF/imagens, texto colado combinado, truncamento. Gaps que valem incorporar agora:
- **PDF**: se a extração de texto vier pobre (< 500 chars), cair para análise visual (multimodal) em vez de falhar.
- Limite de caracteres e aviso de truncamento no modal (hoje 60.000; alinhar comportamento e mensagem).
- Sem mudança de arquitetura: seguimos com TanStack server routes + provider BYOK configurado (não usar chave Gemini direta nem Edge Function como o NEXUS).

### 4. Regressões pendentes do ciclo anterior
- A suíte completa teve 3 arquivos de teste falhando após a mudança do fixture (`otherBrand` passou a ter criador dedicado `userOtherOwner`). Rodar, identificar e ajustar os testes que assumiam que o owner criava as duas brands.

## Validação
- Teste de unidade: schema tolerante + fallback de parse do `failed_generation`.
- Teste de extração com o DOCX real enviado (fixture de teste com mammoth).
- Reexecutar fluxo ponta a ponta no preview autenticado: onboarding rápido → enviar o DOCX → análise → revisão campo a campo → aplicar.
- Typecheck + suíte completa + build OK.

## Fora de escopo
- Não muda RBAC/RLS/auth, tabelas, providers configurados nem a separação Instalação × Workspace.

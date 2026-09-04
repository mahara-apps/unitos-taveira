# Plano final — estabilizar a Importação de Briefing via IA

## Diagnóstico confirmado

- O DOCX enviado está íntegro e legível. A extração produziu aproximadamente **16,6 mil caracteres**, incluindo resumo, detalhes da reunião, participantes e marcações de tempo.
- As três execuções reais chegaram ao fim da etapa de leitura (`ingest = done`) e falharam somente em **Interpretação pela IA**.
- O workspace está configurado com **Gemini como provider principal** e **Groq como fallback**. Não há uso de Cloud AI nesse fluxo.
- O Gemini está caindo como `provider_unavailable`, mas hoje o pipeline não preserva no histórico o motivo técnico completo dessa primeira tentativa.
- Ao assumir a chamada, o Groq rejeita o schema antes de analisar o texto: `confidence`, `evidence` e `speakers` foram tornados opcionais no Zod, porém o provider exige que toda propriedade declarada esteja no array `required` do JSON Schema.
- A tentativa anterior chegou a gerar uma análise coerente do mesmo documento, mas ela foi descartada porque esses três metadados não vieram na resposta. A salvaguarda criada depois não resolve a falha atual, pois agora o schema é recusado **antes da geração**, portanto não existe `failed_generation` para recuperar.
- O modal transforma essa incompatibilidade em uma mensagem genérica, por isso parece que o arquivo não foi interpretado quando, na realidade, a leitura foi concluída com sucesso.

## Implementação

### 1. Unificar e endurecer o contrato de saída do briefing

- Criar um schema compartilhado para os dois workers de importação, eliminando divergência entre texto/DOCX e PDF/imagem.
- Tornar o JSON Schema compatível com Gemini e Groq: todas as propriedades declaradas serão obrigatórias no schema; ausência semântica será representada por `null` ou arrays vazios, nunca por propriedade omitida.
- Manter todos os campos atuais do briefing e os metadados `evidence`, `speakers` e `confidence`.
- Normalizar a resposta depois da geração para tolerar providers que ainda omitam metadados, sem aceitar tipos inválidos nem mascarar payloads malformados.

### 2. Corrigir a execução do provider e do fallback

- Ajustar a chamada estruturada em `analyze-briefing-text.ts` e `analyze-document.ts` para usar o contrato compartilhado.
- Registrar cada tentativa real (`provider`, `model`, resultado e causa) e gravar na run o provider/model que efetivamente respondeu, não apenas o provider inicialmente selecionado.
- Preservar a causa completa da falha primária do Gemini antes de acionar o Groq, permitindo distinguir indisponibilidade, quota, rate limit, modelo inválido e erro de rede.
- Permitir fallback somente para falhas realmente transitórias; erro de schema/request será terminal e corrigido no código, não reenviado para outro provider.
- Manter BYOK e a proibição de fallback silencioso para Cloud AI.

### 3. Consolidar ingestão e origem dos arquivos

- Manter o DOCX deste caso no caminho textual: Mammoth → texto normalizado → mesma import run → análise estruturada.
- Centralizar classificação, extração, normalização, limites e mensagens para evitar divergência entre a extração no navegador e a extração no servidor.
- Preservar os caminhos corretos já existentes:
  - DOCX → texto extraído;
  - XLS/XLSX/CSV → conteúdo estruturado por planilha/aba;
  - TXT/MD/JSON/VTT/SRT e texto colado → texto direto;
  - PDF e imagens → multimodal com Base64 string e MIME separado;
  - DOC legado → rejeição orientada para conversão em DOCX/PDF.
- Preservar a detecção de transcrição e instruir a IA a identificar participantes e inferir papéis somente quando houver evidência, usando `indefinido` quando necessário.

### 4. Robustecer parsing e recuperação da resposta

- Expandir a salvaguarda para tratar resposta válida envolvida em markdown, `failed_generation`, `NoObjectGeneratedError` e metadados ausentes.
- Não recuperar JSON truncado ou estruturalmente inválido como se fosse sucesso.
- Separar claramente: falha de leitura, falha do provider, schema incompatível, resposta inválida e ausência de conteúdo útil.

### 5. Corrigir erro, retry e idempotência na experiência

- Exibir no modal uma mensagem específica para o problema real, sem sugerir que o DOCX está ilegível quando a extração terminou.
- Manter o erro técnico integral no step/log da execução e mostrar apenas texto amigável ao usuário.
- Fazer “Tentar novamente” reutilizar corretamente a origem já processada e criar apenas a tentativa necessária, sem duplicar análises por clique concorrente.
- Manter fingerprint/reuso para o mesmo conteúdo; reanálise paga ocorrerá somente por ação explícita de retry.
- Preservar a sequência `upload → leitura → análise → proposta → revisão → aplicação`, sem aplicação automática.

## Validação obrigatória

- Adicionar teste com **o DOCX real enviado**, verificando extração, detecção de transcrição e conteúdo relevante.
- Cobrir schemas serializados para Gemini e Groq, garantindo que toda propriedade esteja em `required` e que ausências sejam `null`/`[]`.
- Cobrir fallback: falha transitória do Gemini → Groq → proposta válida; erro de schema não deve ser tratado como indisponibilidade.
- Cobrir recuperação de saída com metadados ausentes, JSON em markdown e `failed_generation`; rejeitar JSON truncado/inválido.
- Cobrir texto colado, DOCX, PDF, XLS/XLSX, CSV, TXT, imagem, múltiplos arquivos e transcrição.
- Cobrir briefing vazio, briefing preenchido, informação nova, repetida e contraditória.
- Cobrir idempotência, clique concorrente, retry e aplicação manual idempotente.
- Executar uma chamada real com o provider configurado e o DOCX enviado; confirmar que a run chega a `proposed`, abre revisão campo a campo e só muda o briefing após confirmação.
- Executar typecheck, testes direcionados, suíte completa e build; validar no navegador o fluxo completo e o histórico.

## Limites preservados

- Nenhuma alteração em RBAC, RLS, autenticação, migrations históricas, schema do banco, tenants/workspaces ou separação Instalação × Workspace.
- Nenhuma recriação de tabelas e nenhuma aplicação automática de proposta.

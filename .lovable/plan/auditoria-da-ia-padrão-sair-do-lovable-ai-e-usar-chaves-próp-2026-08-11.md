# Auditoria da IA padrão: sair do Lovable AI e usar chaves próprias

## O que encontrei hoje (verificado no código e no banco)

1. **Existe um seletor próprio funcionando** em Conexões (modelo de texto e de imagem, com chaves por marca criptografadas). O resolvedor `getBrandAiModel` já lê `brand_connections.text_provider/image_provider`, busca a chave em `brand_api_credentials` e nunca cai para o Lovable AI.
2. **Mas só 3 fluxos usam esse resolvedor**: agentes de IA, síntese de aprendizado do Brain e planos mensais. Os demais 15 arquivos chamam o **Lovable AI Gateway direto** com `LOVABLE_API_KEY` e modelos fixos `google/gemini-*`: copiloto inline, geração de imagem de post, insights do dashboard, media plans, embeddings/consolidação do Brain, chat do Brain e os jobs (`post-phase2`, `monthly-plan`, `generate-ideas`, `copilot`, `customer-pipeline`, `analyze-document`).
3. **Chaves de API: não estão operacionais.** O único secret existente no projeto é o `LOVABLE_API_KEY`. O `BRAND_CREDENTIALS_SECRET` (que criptografa/descriptografa as chaves das marcas) não existe após o remix — sem ele qualquer leitura ou gravação de chave lança erro.
4. **As chaves gravadas no banco são herdadas do projeto original** (openai, anthropic e gemini marcadas como conectadas na marca principal), cifradas com a chave antiga. Mesmo com um novo `BRAND_CREDENTIALS_SECRET`, esses ciphertexts não descriptografam — precisam ser re-inseridos.

Resumo: hoje a IA padrão **é** o Lovable AI na maior parte do app, e o caminho de chaves próprias está travado por secret ausente.

## Plano

### Etapa 1 — Destravar as chaves próprias (bloqueante)
- Cadastrar o secret `BRAND_CREDENTIALS_SECRET` (posso gerar um valor aleatório forte).
- Limpar os registros de credenciais herdados do projeto original (`brand_api_credentials` e o mapa `providers` em `brand_connections`), para não exibir provedores "conectados" que não funcionam.
- Você re-insere as chaves OpenAI / Anthropic / Gemini em Conexões e eu valido a gravação e a leitura descriptografada.

### Etapa 2 — Confirmar o seletor padrão operacional
- Validar ponta a ponta: escolher provedor de texto e de imagem em Conexões, salvar, e confirmar que `getBrandAiModel` devolve o provedor e o modelo do catálogo (`ai-models-catalog.server.ts`).
- Rodar o health-check `/api/public/hooks/ai-models-health` para confirmar que cada modelo do catálogo responde com a chave cadastrada.

### Etapa 3 — Remover o Lovable AI dos fluxos restantes
Migrar cada chamada para `getBrandAiModel`, com o papel adequado do catálogo (`strategic`, `operational`, `image`):
- Server functions: `copilot-inline`, `content` (imagem de post), `dashboard` (insights), `media-plans-ai`, `brain/chat-gateway/llm`, `brain/legacy/brain-consolidate`, `brain/legacy/brain-embed`.
- Jobs: `post-phase2`, `monthly-plan`, `generate-ideas`, `copilot`, `customer-pipeline`, `analyze-document`.
- Embeddings ficam vinculados ao provedor OpenAI/Gemini da marca (não há embedding na Anthropic — se o provedor ativo for Anthropic, uso a chave OpenAI/Gemini cadastrada e, se não houver, o recurso informa que precisa de chave).
- Erro claro e traduzido quando não houver chave, em vez de fallback silencioso.
- Ao final, `ai-gateway.server.ts` e o uso de `LOVABLE_API_KEY` saem do app.

### Detalhes técnicos
- Papéis por fluxo: estratégico (planos, estratégia, síntese), operacional (copiloto, jobs, insights), imagem (geração de criativo).
- Todo consumo passa a registrar em `brand_ai_usage` pela marca, mantendo o painel de custo em Conexões coerente.
- Nenhum modelo fixo hardcoded fora de `ai-models-catalog.server.ts`.

## Confirmação necessária
A Etapa 3 toca 15 arquivos. Se preferir, faço primeiro as Etapas 1 e 2 (validação do seletor e das chaves) e a migração completa em seguida.

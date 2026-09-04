# Painel de IA: consumo real de tokens e custo

## O que a auditoria encontrou

Rodei leitura do painel, dos agregadores e do banco. O painel não está quebrado — ele está mostrando a verdade de um registro que quase ninguém alimenta.

**1. Só 2 de 14 pontos de chamada gravam consumo.**
Existem 14 lugares que instanciam o modelo da marca (`getBrandAiModel` / `getBrandAiModelAdmin`): pipeline de estratégia, pauta mensal, geração de ideias, copiloto, análise de documento, chat do Brain, síntese/consolidação do Brain, agentes de post, plano de mídia, dashboard, copiloto inline, agentes. Apenas dois gravam em `brand_ai_usage`: `ai-agents.functions.ts` e `monthly-plan-agent.server.ts`. Todo o resto roda sem registrar nada.

**2. Confirmado nos dados: a tabela está congelada.**
`brand_ai_usage` tem 36 linhas, a última de **14/07/2026**. Como o painel soma apenas o mês corrente, tudo aparece zerado — daí a sensação de "nada está ativo".

**3. Custo sairia $0 mesmo se registrasse.**
Há duas tabelas de preço duplicadas e desatualizadas: uma usa ids sem prefixo (`gemini-2.5-pro`), a outra com prefixo (`google/gemini-2.5-pro`). Nenhuma contempla os modelos em uso hoje (`gemini-flash-latest`). Modelo fora da tabela → custo 0.

**4. "Modelos em uso" nunca foi verificado.**
O card mostra "Nunca verificado" porque a rotina de health check nunca rodou com sucesso neste projeto (o hook estava rejeitando a autenticação; corrigimos o auth, mas ele nunca foi acionado). Por isso ele ainda exibe `gemini-2.5-pro` do catálogo antigo em vez do modelo atualmente resolvido.

**5. Teto mensal (USD) é meia-verdade.**
A checagem de orçamento só é aplicada nos mesmos 2 pontos que registram uso. Como o consumo não é medido nos outros 12, o teto de $10 nunca poderia bloquear nada.

## Como vamos corrigir

### A. Medição automática em todas as chamadas (a correção central)
- Criar um único registrador de uso no ponto por onde **toda** chamada passa: o modelo devolvido por `getBrandAiModel`/`getBrandAiModelAdmin` (mesmo lugar onde já existe o fallback de modelo).
- A cada geração/stream, ele captura tokens de entrada/saída, sucesso/erro, provedor, modelo e grava em `brand_ai_usage` — sem precisar alterar os 14 pontos de chamada, e sem quebrar nada se a gravação falhar.
- Rótulo do agente (`agent`) e cliente (`client_id`) passam a ser informados no momento de pedir o modelo, para o painel poder quebrar consumo por recurso e por cliente.
- Streaming também é contabilizado (hoje nem os pontos que registram cobrem stream).

### B. Preço unificado e atual
- Uma única tabela de preços, normalizando o id do modelo (com ou sem prefixo `google/`, `openai/`) e cobrindo os modelos atuais de Gemini, OpenAI e Anthropic, com fallback conservador quando o modelo for desconhecido.
- Remover as duas tabelas duplicadas.

### C. Teto mensal com efeito real
- A checagem de orçamento passa a valer para toda chamada medida, com erro claro em português quando o teto da marca/cliente for atingido.

### D. Painel mais honesto
- KPIs do mês continuam iguais, mas passam a receber dados de verdade; quando não houver nenhum registro no mês, o painel diz "sem chamadas registradas neste mês" em vez de exibir zeros que parecem falha.
- Quebra de consumo por provedor nos cartões OpenAI/Anthropic/Gemini (hoje eles repetem o total do workspace).
- "Modelos em uso" passa a refletir o modelo efetivamente resolvido agora e registra a data da verificação ao clicar em "Verificar modelos agora".

### E. Validação
- Disparar uma geração real (chat/estratégia) e conferir no banco a linha nova em `brand_ai_usage` com tokens > 0 e custo > 0, e o painel saindo de zero.

## Detalhes técnicos

- `src/lib/ai-provider.server.ts`: o wrapper que já trata fallback de modelo passa a também instrumentar `doGenerate`/`doStream`, lendo `usage` do retorno (e acumulando os deltas de `stream-start`/`finish` no caso de stream) e chamando um novo `recordAiUsage`.
- Novo `src/lib/ai-usage.server.ts`: `recordAiUsage` (insert best-effort com `supabaseAdmin`), `estimateCost` unificado e `PRICE_PER_MTOK` normalizado por id.
- `getBrandAiModel`/`getBrandAiModelAdmin` ganham um parâmetro opcional de contexto (`agent`, `clientId`, `userId`) usado apenas para etiquetar o registro; os 14 pontos de chamada passam a informá-lo aos poucos, sem mudança de comportamento.
- `src/lib/ai-agents.functions.ts` e `src/lib/monthly-plan-agent.server.ts`: remover o insert manual e as tabelas de preço locais para evitar contagem dupla.
- `src/lib/connections.functions.ts`: retornar também consumo por provedor (agrupado por prefixo do modelo) e a contagem de chamadas do mês.
- `src/routes/_authenticated/connections.tsx`: estado vazio explícito nos KPIs e consumo por provedor nos cartões.
- Sem mudança de schema: `brand_ai_usage` já tem `brand_id`, `client_id`, `agent`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `success`, `error_message`, `actor_id`.

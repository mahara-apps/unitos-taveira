# Aba "Estratégia IA" com histórico de gerações

## Objetivo

Tirar os resultados da IA (Estratégia/Voz, Personas & Público, Análise de Mercado) de dentro do briefing e colocá-los numa aba própria na tela do cliente, com data de geração visível e acesso às gerações anteriores.

## O que muda para o usuário

**Nova aba "Estratégia IA"** (ao lado de "Briefing & Estratégia") com duas visões:

1. **Atual** — os painéis que hoje aparecem no fim do briefing (Estratégia/Voz, Personas & Público, Mercado/SWOT), agora com um cabeçalho mostrando "Gerada em 11/08/2026 às 10:32" e o provedor/modelo usado, além do botão "Gerar Inteligência".
2. **Histórico** — lista das gerações anteriores (mais recente primeiro), cada linha com data/hora, quais blocos aquela geração produziu (voz, personas, cohorts, SWOT) e quem disparou. Ao abrir uma geração:
   - **Visualizar** em modo somente leitura, com aviso "versão de 20/07 — não é a vigente";
   - **Restaurar como versão ativa** (com confirmação), promovendo aquela geração de volta a vigente e mandando a atual para o histórico;
   - **Copiar** cada bloco como texto (e exportar a geração inteira em texto/Markdown).

A aba "Briefing & Estratégia" passa a conter só o formulário de briefing, com um link "Ver resultados da IA" que leva à nova aba.

## Base de dados

Nada de novo é necessário: o pipeline já **preserva** o histórico — ao gravar uma nova geração ele marca as linhas anteriores de `brand_voice_cards`, `brand_personas`, `brand_cohorts` e `brand_swot` como `is_active = false` em vez de apagá-las, e cada linha tem `created_at`. Edições manuais já viram snapshot em `brand_ai_versions`.

## Detalhes técnicos

- Nova rota `src/routes/_authenticated/customers.$customerId.estrategia.tsx` + entrada `estrategia` na lista de abas de `customers.$customerId.tsx` (aba controlada, como as demais); remover `appendSlot` com `StrategyTab`/`TargetTab`/`MarketTab` do `BriefingWorkspace` e montá-los na nova aba.
- Novo componente `src/components/ai-agents/strategy-results.tsx`: cabeçalho com data/provedor + os três painéis existentes reaproveitados (`StrategyTab`, `TargetTab`, `MarketTab`) e sub-abas Atual/Histórico.
- Novo componente `src/components/ai-agents/strategy-history.tsx` para a lista e o visualizador somente-leitura.
- `src/lib/ai-agents.functions.ts`: adicionar
  - `listStrategyRunsFn({brandId, clientId})` — lê as 4 tabelas incluindo linhas inativas, agrupa por janela de tempo próxima (`created_at` arredondado, tolerância de minutos) formando "gerações", retornando id por bloco + data + `created_by`;
  - `getStrategyRunFn({brandId, clientId, ids})` — devolve o `data` de cada bloco daquela geração;
  - `restoreStrategyRunFn({brandId, clientId, ids})` — em cada tabela envolvida: desativa a linha ativa atual e reativa a escolhida (mesma tabela/cliente), com verificação de papel de escrita como nas outras mutações do arquivo.
- Data/provedor de geração: usar `created_at` do bloco e o mapa `{ etapa: "provider:modelo" }` já gravado em `ai_jobs.result` pelo pipeline; exibir "—" quando ausente (gerações antigas).
- Invalidar `CUSTOMER_QUERY_KEYS.core/target/market` após restaurar, reaproveitando `invalidateAll` já existente na rota do cliente.
- `head()` próprio na nova rota, seguindo o padrão das outras rotas de cliente.

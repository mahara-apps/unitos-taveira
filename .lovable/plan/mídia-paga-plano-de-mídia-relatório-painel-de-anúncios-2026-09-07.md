# Mídia Paga: Plano de Mídia + Relatório (painel de anúncios)

## O que a verificação mostrou (fatos)

- O app Meta ("unitos", ID 1647626272966474) responde às requisições de teste e
  **já solicita** `ads_read` + `business_management`.
- Existe autorização gravada em que `ads_read` foi **efetivamente concedida** —
  ler contas, campanhas, conjuntos, anúncios e métricas é viável hoje, sem nova
  aprovação da Meta.
- As autorizações mais recentes foram feitas pelo caminho "Instagram/Facebook",
  que pede só permissões de página; nessas, anúncios ficam de fora e será
  preciso reautorizar.
- Nenhuma conta de anúncio está gravada, porque a busca só roda quando a conexão
  é do tipo "ads".
- O app **não** pede permissão de escrita em anúncios; criar/pausar campanha ou
  mexer em orçamento exigiria revisão da Meta e está fora deste escopo.

## Decisões

- Somente leitura e relatórios (nenhuma escrita na Meta).
- Contas de anúncio vinculadas a clientes (uma ou mais por cliente).
- Modelo de dados neutro por rede, já preparado para Google Ads; agora só Meta.

## Estrutura de Mídia Paga

A área passa a ter duas opções claras:

1. **Plano de mídia** — o fluxo atual de criação/gestão de planos, preservado.
   Fica preparado para, em fase seguinte, a IA ler os dados reais dos anúncios
   como apoio ao plano (nesta fase apenas a base de dados é criada).
2. **Relatório** — o painel novo descrito abaixo.

## Painel de Relatório

**Filtros de período** (padrão: últimos 30 dias): Ontem, Últimos 7, 15, 30 e 90
dias, Este mês, Mês passado, além de intervalo personalizado. Sempre no fuso
oficial de Brasília e com contagem inclusiva de dias, reaproveitando o seletor
de período já existente no sistema. Filtro de cliente/conta de anúncio no topo.

**Visão geral**: investimento, impressões, alcance, cliques, CTR, CPC, CPM,
resultados e custo por resultado, com evolução diária e comparação opcional com
o período anterior.

**Três níveis navegáveis**, do maior para o menor, cada um com tabela ordenável
e clique para abrir o detalhe:

- **Campanhas** — objetivo, situação, investimento e resultados.
- **Conjuntos de anúncios** — dentro da campanha escolhida.
- **Anúncios / criativos** — com **prévia visual** do criativo (miniatura da
  imagem ou do vídeo, texto principal, título e destino), lado a lado com os
  números daquele anúncio.

**Detalhe do anúncio**: prévia grande do criativo + relatório completo daquele
anúncio (números do período, evolução diária, e quebras por plataforma e por
posicionamento quando a Meta devolver).

**Linguagem prática**: rótulos em português comum ("Quanto foi investido",
"Pessoas alcançadas", "Custo por resultado"), com uma frase curta de explicação
em cada indicador e destaque automático dos anúncios que gastam mais sem
resultado e dos que têm melhor custo por resultado — sem jargão de plataforma.

**Estados explícitos**: sem conta vinculada, autorização sem acesso a anúncios
(com atalho para reautorizar), sem dados no período, limite de requisições da
Meta atingido e erro.

## Detalhes técnicos

- `src/lib/meta/provider.server.ts`: acrescentar `ads_read` aos conjuntos de
  escopo de `instagram`/`facebook`; novos métodos de leitura para campanhas,
  conjuntos, anúncios e criativos (`/act_<id>/campaigns|adsets|ads`,
  `adcreatives` com `thumbnail_url`, `image_url`, `object_story_spec`) e para
  insights (`/act_<id>/insights` com `level` e `breakdowns` de plataforma e
  posicionamento), sempre com teto de paginação, deadline, telemetria e
  tratamento de limite iguais aos já existentes.
- Migration nova (MASTER):
  - `public.ad_accounts` (provider `meta|google`, external_id, nome, moeda,
    fuso, situação, brand_id) e `public.client_ad_accounts` (vínculo
    cliente × conta, com unicidade).
  - `public.ad_entities` (campanha/conjunto/anúncio, hierarquia por
    `parent_external_id`, nome, objetivo, situação) e `public.ad_creatives`
    (miniatura, imagem, título, texto, destino) para a prévia.
  - `public.ad_insights_daily` como cache normalizado por dia/nível/entidade,
    com métricas em colunas neutras, quebras opcionais e `raw` JSONB.
  - Para cada tabela: `GRANT` a `authenticated`/`service_role`, RLS habilitada e
    políticas de escopo por workspace/cliente reaproveitando as funções de
    acesso existentes.
- Server functions autenticadas em `src/lib/ads/` (`ads.functions.ts`,
  `insights.server.ts`), nenhum endpoint público, nenhuma chamada Graph no
  cliente. Cache persistido com revalidação em segundo plano e cooldown, no
  mesmo padrão já usado nas APIs Meta.
- Prévias de criativo carregadas pelas URLs da Meta (expiram), com regeneração
  na revalidação e imagem de reserva quando indisponível.
- UI: rotas `/_authenticated/paid-media.plans` (fluxo atual) e
  `/_authenticated/paid-media.report`, com o mesmo cabeçalho de Mídia Paga e
  troca entre as duas opções; aba equivalente no cliente. Uso de
  `PageKpi`/`PageKpiGrid` e dos componentes de visualização do Analytics.
- Sidebar: item "Mídia Paga" com as duas opções, sem remover nada do menu atual.
- Permissões: Owner/Admin veem o workspace; Manager/User apenas clientes
  atribuídos; cliente no Portal não vê esta área nesta fase.
- Testes: escopos por canal, hierarquia campanha→conjunto→anúncio, mapeamento de
  insights e quebras, presets de período, vínculo cliente × conta, escopo por
  papel e estados de erro/limite.

## MASTER-first

Regenerar o pacote delta, atualizar `delta_version.txt` e
`MASTER_RELEASE_VERSION` para a próxima versão, cobrir as tabelas novas na
verificação 80 de `verify-installation.sql` e rodar `bun run master:check`,
typecheck e build antes de concluir.

## Fora de escopo

Criar/editar/pausar campanhas, orçamento e públicos (qualquer escrita na Meta);
integração real com Google Ads (apenas o modelo fica preparado); análise por IA
dos dados de anúncios, que entra na fase seguinte sobre esta base.

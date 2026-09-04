# Auditoria READ-ONLY — Portal do Cliente (Unitos)

Data: 2026-08-18. Nenhum arquivo de produto, banco, RLS ou server function foi alterado.

## 1. Mapa atual

### Rotas
| Rota | Modo | Componente |
| --- | --- | --- |
| `/portal/$token` (+ `/`, `/aprovacoes`, `/calendario`, `/arquivos`, `/briefing`) | token público | `routes/portal.$token*.tsx` → shell próprio |
| `/_portal/area` (+ `/inicio`, `/aprovacoes`, `/calendario`, `/arquivos`, `/briefing`) | login (`client_members.role='portal_client'`) | `routes/_portal/area*.tsx` → shell próprio |
| `/p/briefing/$token` | token legado de briefing | `routes/p.briefing.$token.tsx` |
| `/pauta/$planId`, `/plano/$planId` | link público de pauta | rotas isoladas fora do portal |

Ambos os shells são praticamente idênticos (sidebar, nav mobile, header, tema white-label) — duplicação de ~180 linhas cada.

### Camada de dados (correta e deve permanecer)
`components/portal/portal-context.tsx` (`usePortalApi`) abstrai token vs sessão. Server fns: `portal-public.functions.ts` (token, com rate limit por IP hash), `portal-session.functions.ts` (login), `portal-pauta.functions.ts`, `portal-briefing.functions.ts`.

RPCs usadas: `portal_resolve`, `portal_metrics`, `portal_approvals`, `portal_post`, `portal_decide`, `portal_calendar`, `portal_files`, `portal_briefings`, `portal_my_clients`, `portal_rate_status/_register_failure`, `_portal_session_any`. Pauta usa `monthly-plan-decision.server.ts`.

### Dados reais (contagens de produção)
- posts com `visible_in_portal`: **32** · aprovações: **3** · pautas: **8**
- documentos com `visible_to_client`: **0** (6 documentos existem) → aba Arquivos sempre vazia
- `brand_briefing_requests`: **0** · tokens legados de briefing: **0**
- usuários de portal (`portal_client`): **0** · tokens de portal: **6** → hoje **só o modo token está em uso**
- `calendar_events`: 0 (o calendário do portal usa `posts.scheduled_at`, não essa tabela)
- `clients.brand_hub` preenchido: 5 clientes → há substrato real para "Minha Marca"

## 2. O que funciona e permanece
1. Resolução de escopo blindada (`_portal_session_any`, `portal_resolve` expõe só campos públicos) e rate limit do token.
2. Aprovação de conteúdo (card → dialog com mídia, legenda, roteiro, aprovar/ajustar/rejeitar/comentar, exigência de identidade no modo token).
3. Aprovação de pauta item-a-item com criação de peças (`portal-pauta.tsx` + decision server).
4. Briefing por solicitação: formulário dinâmico, anexos, complementação parcial, staging para revisão da agência.
5. Arquivos: listagem + URL assinada (`signPortalDocument`).
6. Tema white-label (`portal-theme.ts`) e multi-cliente autenticado (`portal_my_clients` + seletor).
7. `usePortalApi` como única porta de dados — nenhuma tela sabe o modo.

## 3. Duplicado (remover na refatoração visual)
- **Dois shells** (`portal.$token.tsx` e `_portal/area.tsx`) com o mesmo layout → extrair `PortalShell` único parametrizado por modo.
- **Duas fontes de navegação**: `portal-nav.ts` (`to`/`segment`) + `SESSION_PATHS`/`TOKEN_PATHS`/`SESSION_SUFFIX` em `portal-context.tsx` e `area.tsx` → uma única tabela de abas.
- **Dois caminhos de briefing**: solicitação nova (`brand_briefing_requests`) e `LegacyBriefingLinks` → `/p/briefing/$token` (0 registros).
- **Dois caminhos de pauta**: aba dentro de Aprovações e as rotas públicas `/pauta/$planId` · `/plano/$planId`.
- KPIs próprios na Home (`HOME_TONES`) duplicando o padrão canônico `PageKpi`.

## 4. Quebrado / sem dado real
- **Arquivos**: 0 documentos marcados como visíveis → aba vazia por configuração, não por bug.
- **Briefing**: 0 solicitações → tela hoje cai sempre no empty state; único conteúdo visível seria o legado (também 0).
- **Modo login**: 0 usuários `portal_client` — caminho implementado e testado, porém nunca exercitado em produção.
- **Identidade no modo login**: `identity` é `{ value: "", save: noop }` → decisões ficam sem nome amigável (o backend usa o usuário, mas a UI não mostra quem decidiu).
- **Home**: KPI "Total de posts" é métrica interna sem ação; texto de boas-vindas cita "abas ao lado" (errado no mobile).
- **`PortalNav`** calcula `homePath` e descarta (`void homePath`) — código morto.

## 5. Fantasma / eliminar
- **Reuniões**: não existe nada (nem rota, nem tabela, nem componente). Não reintroduzir.
- **Notificações**: 544 registros, todos internos; nenhum consumo no portal. Fora do escopo do cliente.
- **Histórico/atividade**: `client_journey_events` (2 registros) e `activity_events` não são lidos pelo portal — manter fora; o histórico útil ao cliente é o de suas próprias decisões.
- Vocabulário técnico exposto ao cliente: `stage`, `format`, `channels` cru, status em inglês, "portal white-label", contadores mono/uppercase.

## 6. Mudar de lugar
- **Pauta** sai de sub-aba de Aprovações e vira aba de primeiro nível.
- **Briefing** absorve o legado por token (somente leitura, se houver histórico) e some quando não há nada — a pendência aparece na Início.
- **Minha Marca** (nova aba, leitura de dados já existentes em `clients.brand_hub` + `portal_resolve`): identidade, público, tom de voz, metas — nada editável aqui, complementação segue pelo fluxo de briefing.
- Total de posts sai da Início; Início passa a mostrar somente pendências + próximas publicações.

## 7. O que falta para o Portal cumprir o objetivo
1. Início orientada a ação (o que preciso fazer / o que vem por aí), não a KPIs de agência.
2. Linguagem de cliente: "Aguardando sua aprovação", "Publicado", "Em ajuste".
3. Um único shell responsivo (mobile-first: o cliente aprova pelo celular).
4. Visibilidade do que o cliente já decidiu (histórico simples por peça/pauta).
5. Estados vazios que ensinam ("a equipe ainda não compartilhou arquivos") e não parecem erro.
6. Nada de token visível, nada de IDs, nada de jargão de pipeline.

## 8. Estrutura final proposta por tela

Navegação: **Início · Aprovações · Pauta · Calendário · Briefing · Arquivos · Minha Marca**

- **Início** — `PageKpiGrid` com 3 KPIs de ação (Aguardando você · Aprovados no mês · Próximas publicações) + lista "Precisa da sua atenção" (peças pendentes, pauta aguardando, briefing solicitado) + "Próximos 7 dias".
- **Aprovações** — filtros Pendentes/Aprovados/Ajustes/Todos, grade de cards com capa, canal e prazo, dialog atual mantido (fluxo intacto).
- **Pauta** — lista de pautas do mês (badge "aguardando você") + detalhe item-a-item existente, sem alteração de regra.
- **Calendário** — mês atual, chips de canal, dia com peças; clique abre a mesma peça de Aprovações. Sem edição.
- **Briefing** — pendências em destaque (form dinâmico atual), depois "respostas enviadas" com status da revisão; legado só como histórico.
- **Arquivos** — busca + lista com tipo, tamanho, data e download; empty state explicativo.
- **Minha Marca** — leitura do briefing aprovado agrupado por blocos (`BRIEFING_BLOCKS`), com CTA "solicitar atualização" apenas se houver solicitação aberta.

## 9. Componentes reutilizáveis do padrão novo
`PageKpi`/`PageKpiGrid` (obrigatório para todo KPI), `Badge`, `Button`, `Input`/`Textarea`, `Dialog`/`ExpandedModal`, `Skeleton`, `Select`, `EmptyState` (promover a padrão único), stage/channel tone helpers de `components/content/stage-colors.ts` traduzidos para linguagem de cliente.

## 10. Fluxos que devem permanecer exatamente como estão
1. Resolução de escopo e RLS (`_portal_session_any`, `portal_resolve`) e rate limit do token.
2. `portal_decide` e bloqueio de decisão em conteúdo publicado.
3. Decisão de pauta item-a-item e materialização de peças.
4. Briefing: proposta em staging → revisão da agência → promoção versionada ao `clients.brand_hub`.
5. Assinatura de mídias/documentos no servidor.
6. Coexistência token ⇄ login com `usePortalApi` como única porta de dados.

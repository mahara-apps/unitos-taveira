# Auditoria somente leitura — Módulo de Clientes (Unitos)

Snapshot: 14/08/2026. Nenhuma alteração de código, banco, layout ou componente foi feita.

---

## A. Modelo atual do cliente

Tabela principal: **`public.clients`** (30 colunas).

| Campo | Tipo | Null | Default | Uso real hoje |
|---|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() | PK |
| `brand_id` | uuid | NO | — | FK `brands` (tenant) |
| `name` | text | **NO** | — | tudo (UI, IA, portal) |
| `niche` | text | YES | — | lista, contexto IA |
| `color` | text | YES | `#6366f1` | avatar, contexto IA (paleta) |
| `contact_name` | text | YES | — | cadastro; **usado erroneamente como "Responsável" na lista** |
| `contact_email` | text | YES | — | cadastro/portal |
| `contact_phone` | text | YES | — | cadastro (canônico do telefone) |
| `tone_of_voice` | text | YES | — | fallback de `TONE`/`TONE_OF_VOICE` nos agentes |
| `palette` | jsonb | YES | `[]` | legado — a paleta usada é `brand_hub.palette` |
| `socials` | jsonb | YES | `[]` (tipo errado, é objeto) | handles; **não é vínculo de canal** |
| `logo_url` / `logo_secondary_url` / `favicon_url` | text | YES | — | identidade visual (Briefing/Identidade) |
| `brand_hub` | jsonb | **NO** | `{}` | **coração do briefing/IA** (ver §D) |
| `website`, `address` | text | YES | — | aba Cadastro (address quase não usado) |
| `is_active` | bool | NO | true | filtros, IA, SLA, dashboards |
| `archived_at` | timestamptz | YES | — | soft delete (`listClients` filtra) |
| `owner_user_id` | uuid | YES | — | FK `auth.users`; responsável interno real |
| `monthly_contract_value`, `margin_percent`, `contract_status`, `contract_start_date`, `contract_renewal_date`, `internal_notes`, `journey_stage` | — | — | `ativo` / `onboarding` | somente aba **Gestão da conta** (`client-journey.functions.ts`) |
| `portal_theme` | jsonb | NO | `{"mode":"system"}` | Portal do cliente |
| `created_at`, `updated_at` | timestamptz | NO | now() | ordenação/"última atividade" |

### Relacionamentos (FKs apontando para `clients`) — 34 tabelas
`activity_events`, `ai_jobs`, `ai_usage_limits`, `brand_ai_content`, `brand_ai_usage`, `brand_ai_versions`, `brand_briefings`, `brand_cohorts`, `brand_competitors`, `brand_media_assets`, `brand_pautas`, `brand_personas`, `brand_swot`, `brand_voice_cards`, `calendar_events`, `chat_conversations`, `client_briefing_tokens`, `client_briefings`, `client_documents`, `client_journey_events`, `client_members`, `client_social_accounts`, `content_pipelines`, `media_plans`, `monthly_plans`, `monthly_plan_tokens`, `plan_overage_requests`, `portal_tokens`, `posts`, `post_placements`, `projects`, `social_connections` (coluna legada, deprecada), `social_posts`, `tasks`.

Saída do cliente: `brand_id → brands`, `owner_user_id → auth.users`.

### Estado dos dados (7 clientes)
- 1 sem nicho, 4 sem responsável (`owner_user_id`), 4 sem e-mail de contato.
- 2 com `brand_hub = {}` (sem briefing algum) e apenas 3 com `tone_of_voice`.
- 19 `brand_briefings`, 13 `brand_personas`, **1 único vínculo em `client_social_accounts`** → gargalo real do fluxo de publicação.

---

## B. Classificação dos campos

**A. Obrigatórios na criação** — `name` (única obrigatoriedade real hoje), `brand_id` (contexto ativo).

**B. Importantes no onboarding** (destravam IA/operação): `niche`, `owner_user_id`, `contact_name`, `contact_email`, `color`/`logo_url`, `brand_hub.description|mission|positioning`, `brand_hub.offer`, `brand_hub.audience|pain_points|desires`, `brand_hub.tone_text`, `brand_hub.goals`, `brand_hub.volumetry` + `volumetry_basis`, vínculo em `client_social_accounts`.

**C. Podem vir depois**: `website`, `address`, `contact_phone`, `socials.*`, `brand_hub.values|price_range|differentials|objections|journey|inspirations|hashtags|do_dont|formats`, `palette` (hub), `logo_secondary_url`, `favicon_url`, `portal_theme`, personas/SWOT/voice card (gerados por IA), documentos.

**D. Não deveriam estar no cadastro inicial**: contrato/financeiro (`monthly_contract_value`, `margin_percent`, `contract_*`, `internal_notes`, `journey_stage`) e tema do portal.

**E. Redundantes/duplicados**:
- `clients.palette` (legado) × `brand_hub.palette` (real).
- `clients.tone_of_voice` × `brand_hub.tone_text` (o contexto de IA prefere o hub).
- `socials.phone` × `contact_phone` (já canonicalizado em `contact_phone`, mas o campo antigo persiste no jsonb).
- `contact_name` sendo exibido como "Responsável" na lista, enquanto o responsável real é `owner_user_id`.
- `brand_briefings` × `clients.brand_hub` × `client_briefings` (três lugares com briefing; hub é a fonte usada pela IA).

**F. Persistidos mas praticamente sem uso**: `clients.palette`, `address` (só leitura/escrita na aba Cadastro), `socials.notes`, `margin_percent` (sem consumo em relatório), `favicon_url`/`logo_secondary_url` (só Identidade Visual).

---

## C. Dependências (mapa)

```text
CLIENTE (clients)
  ├─ name/niche/color/logo ─────────► Avatar, lista, portal, contexto IA
  ├─ owner_user_id ────────────────► responsável, SLA, notificações
  ├─ brand_hub (jsonb) ────────────► BRIEFING (Briefing Workspace)
  │      └─ volumetry/basis/formats ► PAUTA (cotas por canal) + excedentes
  ├─ brand_briefings ──────────────► ESTRATÉGIA IA (input_briefing_id)
  ├─ brand_personas/voice/swot/cohorts ► AGENTES (PERSONAS, TONE)
  ├─ client_documents.ai_summary ──► CONTEXT (blueprint)
  ├─ client_social_accounts ───────► CANAIS do cliente (fonte de verdade)
  ▼
PAUTA (monthly_plans/topics) → aprovação cliente → MATERIALIZAÇÃO
  → posts (peça) + tasks (produção) + projects (projeto da pauta)
  → post_agents (copywriter/roteirista/art director) preenche caption
  → post_placements(connection_id) → CALENDÁRIO → PUBLICAÇÃO (social_posts)
```

Pontos onde o cadastro atual **quebra a cadeia**:
1. Criação só grava `name/niche/color/logo/socials.instagram` → `brand_hub` nasce `{}`; toda geração de IA parte de contexto vazio (visto em 2 clientes).
2. `owner_user_id` fica nulo → SLA/responsável e a coluna "Responsável" da lista caem em `contact_name` (dado errado).
3. Volumetria não é coletada no onboarding → Pauta não tem cotas por canal (só depois, no Briefing).
4. Nenhum vínculo de canal é criado → materialização gera peças sem `target_connection_ids`, bloqueando agendamento/publicação (1 vínculo em 7 clientes).
5. `socials.instagram` do cadastro dá falsa sensação de "canal conectado" (é apenas handle textual, não `client_social_accounts`).

---

## D. Dados que a IA realmente consome

Fonte única de contexto: `loadBriefingContext` (`src/lib/monthly-plan-context.server.ts`) + blueprint em `ai-agents.functions.ts`, hidratados nas variáveis de `agent-variables.ts`.

| Variável | Origem | Consumidores |
|---|---|---|
| `CONTEXT` | `clients` + `clients.brand_hub` + `brand_competitors` + `client_documents.ai_summary` | todos os agentes |
| `BRAND_CONTEXT` | `brand_hub.description/mission` | briefing_extractor, planner_strategic |
| `PERSONAS` / `PERSONA` | `brand_personas.data` (ativas) | persona_generator (saída), copywriter_senior, roteirista_social |
| `TONE` / `TONE_OF_VOICE` | `brand_voice_cards.data` → fallback `clients.tone_of_voice` / `brand_hub.tone_text` | copywriter, roteirista, art director |
| `HASHTAGS` | `brand_hub.hashtags` | copywriter |
| `COMPETITORS` | `brand_competitors.handle` (+ `brand_hub.competitors`) | planner_strategic, swot |
| `PRIMARY/SECONDARY/TERTIARY_COLORS` | `brand_hub.palette` | art_director_social |
| Volumetria/formatos | `brand_hub.volumetry`, `volumetry_basis`, `formats` | pauta.suggest / planner_strategic |
| Briefing da peça | `posts.internal_briefing`, `client_briefing`, tópico da pauta | copywriter/roteirista/art director |

Agentes de estratégia (`ai-agents.functions.ts`): `briefing.parse`, `voice.generate`, `personas.generate`, `cohorts.generate`, `swot.generate`, `pauta.suggest`, `content.generate`, `competitor.extract`.
Agentes de peça (`post-agents.server.ts`): `copywriter_senior` (sempre), `roteirista_social` (vídeo), `art_director_social` (estático sem direção).

**Mínimo para qualidade aceitável**: nicho, oferta/produto, público + dor + desejo, tom de voz, objetivo, 3+ concorrentes/inspirações, hashtags, paleta/logo e volumetria por canal. Sem esses itens o copywriter gera texto genérico (é exatamente o cenário dos clientes com `brand_hub = {}`).

---

## E. Perfil do cliente (abas atuais)

`src/routes/_authenticated/customers.$customerId.tsx` — 8 abas:

| Aba | Conteúdo | Editável | Observação |
|---|---|---|---|
| Visão geral | 8 cards (resumo, pipeline, performance, brain, atenção, atividade, próximos, info) | leitura | `overview-client-info` duplica dados do Cadastro |
| Briefing | Briefing Workspace (`brand_hub`) + identidade visual + volumetria | sim | fonte de verdade da IA |
| Estratégia IA | geração + histórico | sim (gerar) | grava `brand_ai_content/versions` |
| Pauta | pauta mensal | sim | consome volumetria |
| Produção | relatório + excedentes | leitura/aprovação | |
| Canais | vínculo `client_social_accounts` | admin/manager | não conecta contas (correto) |
| Gestão da conta | contrato, financeiro, journey_stage, notas, responsável | admin/manager | único consumidor dos campos de contrato |
| Cadastro | nome, nicho, site, endereço, contato, socials | owner/manager | fonte única do registro |

Duplicações na tela: nome/nicho aparecem em Cadastro, Briefing (identidade) e Visão geral; tom de voz aparece em Cadastro (curto) e Briefing (`tone_text`); responsável aparece em Gestão (correto) e é inferido de `contact_name` na lista (errado).

---

## F. Criação de cliente hoje

Dois caminhos concorrentes:
1. `QuickCreateCustomerDrawer` (botão principal) — **1 etapa**: nome, nicho, cor, logo (upload → `brand-assets` + signed URL 10 anos), Instagram (handle). Chama `createClient`, invalida `["clients", brandId]` e navega para `/customers/:id?onboarding=1`.
2. `CustomerFormDialog` dentro de `customers.index.tsx` (usado no editar, mas também aceita criar) — nome, nicho, cor, tom de voz, contato, ativo, responsável, socials. Schema diferente do drawer → duas verdades de validação.

Grava **apenas** em `clients`. Não cria: `brand_briefings`, `content_pipelines`, `client_social_accounts`, `portal_tokens`, `ai_usage_limits`, `client_members`. Depois do salvar, tudo (briefing, volumetria, canais, contrato, portal) precisa ser configurado manualmente aba por aba.

---

## G/H. Wizard recomendado (proposta, não implementado)

Baseado no que o banco/IA realmente consomem — 4 etapas obrigatórias + 2 opcionais, com "salvar e continuar depois" a partir da etapa 2 (o cliente já existe após a etapa 1).

**Etapa 1 — Identificação (obrigatória)** → `clients`
`name`*, `niche`*, `owner_user_id`* (responsável), cor + logo, site.

**Etapa 2 — Negócio e oferta** → `clients.brand_hub`
`description/mission`, `offer`, `price_range` (opcional), `differentials`.

**Etapa 3 — Público e tom** → `clients.brand_hub`
`audience`, `pain_points`, `desires`, `tone_text` (+ tags), `do_dont` (opcional).

**Etapa 4 — Objetivos e volumetria (obrigatória para Pauta)** → `clients.brand_hub`
`goals`, `volumetry` por canal + `volumetry_basis`, `formats` preferidos.

**Etapa 5 — Canais (opcional, admin/manager)** → `client_social_accounts`
Somente vincular canais já conectados no workspace; sem conectar nada aqui.

**Etapa 6 — Revisão + "Gerar inteligência"**
Mostra % de completude (`briefing-progress.ts`), cria `brand_briefings` inicial e oferece disparar a Estratégia IA (personas/voice/SWOT). Contato completo e concorrentes/hashtags/inspirações entram como campos opcionais recolhidos (accordion), não como etapas.

**Fora do wizard**: contrato/financeiro, `journey_stage`, notas internas, `portal_theme`, favicon/logo secundário, documentos, personas manuais, endereço.

---

## I. Lista de clientes — estrutura recomendada

Hoje (modo lista): Cliente | Status | Estratégia | Responsável | Última atividade | Ações. Problemas: textos em inglês ("Strategy Active", "Ready for Bootstrap", "Updated 3d ago", "Unassigned"), "Responsável" vindo de `contact_name`, "Estratégia" binária baseada só em `has_briefing`, toggle grid/lista redundante, 4 KPIs de baixo valor (inclui "Nichos").

Proposta (lista como visão principal, PT-BR, densa):

| Coluna | Fonte | Por quê |
|---|---|---|
| Cliente (avatar + nome + nicho) | `clients` | identificação |
| Status | `is_active` + `contract_status` | operação real |
| Onboarding/Briefing | `computeBriefingCompletion` (barra %) | mostra o que falta para a IA |
| Canais | `client_social_accounts` (ícones) | destrava publicação |
| Pauta do mês | `monthly_plans.status` | estado editorial |
| Produção | contagem de peças por estágio | carga operacional |
| Responsável | `owner_user_id` → `user_profiles` | correto |
| Última atividade | `activity_events`/`updated_at` | saúde |
| Ações | abrir, editar, arquivar | — |

Filtros: busca por nome/nicho, status, responsável, nicho, "briefing incompleto", "sem canal vinculado", "sem pauta no mês". Ordenação por qualquer coluna. KPIs reduzidos a 3: clientes ativos, briefings incompletos, clientes sem canal vinculado.

---

## J. Fluxo ideal de onboarding

Criar (etapa 1) → cliente existe e já aparece na lista com "Onboarding 20%" → wizard progressivo (2→4) → vincular canais → gerar inteligência (personas/voice/SWOT) → gerar Pauta → aprovação interna (cria Projeto) → aprovação do cliente (materializa peças + tarefas + agentes) → calendário/publicação. Contrato e portal entram depois, na aba Gestão da conta.

---

## K. Riscos de alteração

1. **Dois formulários de criação** com schemas divergentes — unificar sem quebrar o fluxo de edição da lista.
2. `createClient` não aceita `brand_hub`, `website`, `contact_phone`, `journey_stage` — o wizard exigirá `updateClient`/`saveBrandHub` em sequência (risco de cliente criado pela metade se falhar no meio; precisa ser idempotente/retomável).
3. Tornar `owner_user_id` obrigatório pode travar criação por usuários sem lista de time carregada.
4. `clients.palette` e `socials.phone` legados: remover leitura sem migração pode afetar `analytics.tsx`, `dashboard.functions.ts` e Brain.
5. Volumetria alimenta cotas e excedentes — mudar o formato de `brand_hub.volumetry`/`basis` afeta Pauta, excedentes e relatórios.
6. Lista com colunas agregadas (canais/pauta/produção) exige novo endpoint agregado; fazer no servidor para não gerar N+1.
7. Não tocar em `social_connections` × `client_social_accounts` (arquitetura já consolidada).

---

## L. Ordem recomendada de implementação

1. Corrigir semântica da lista: responsável por `owner_user_id`, textos PT-BR, remover toggle grid e KPI "Nichos".
2. Criar endpoint agregado `listClientsOverview` (briefing %, canais, pauta, produção, última atividade).
3. Refatorar a lista (tabela ordenável + filtros + 3 KPIs).
4. Unificar criação: um único `createClient` estendido (aceitar `website`, `contact_phone`, `owner_user_id`, `brand_hub` inicial) e remover o formulário duplicado da index.
5. Implementar o wizard em 4 etapas obrigatórias + 2 opcionais, retomável (badge "Onboarding X%" na lista abre o wizard no passo pendente).
6. Etapa de canais reaproveitando o picker existente do perfil.
7. Etapa de revisão com disparo da Estratégia IA.
8. Limpeza de legados (`clients.palette`, `socials.phone`) e desduplicação do bloco de info da Visão geral.

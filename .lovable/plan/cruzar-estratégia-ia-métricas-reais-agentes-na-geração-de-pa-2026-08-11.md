# Cruzar Estratégia IA + métricas reais + agentes na geração de Pauta

## O que existe hoje (verificado)

- `generateMonthlyPlanFn` / `regenerateTopicFn` (`src/lib/monthly-plans.functions.ts`) montam o prompt com: briefing consolidado (`loadBriefingContext`) + contexto do Brain (`brain.getContext`) + cotas do wizard. Chamam `generateText` direto com `getBrandAiModel(..., "text")`.
- A **Estratégia IA** gerada no Briefing vive em tabelas próprias (`brand_voice_cards`, `brand_personas`, `brand_cohorts`, `brand_swot`, com `is_active`) — e **nenhuma delas é lida** na geração da pauta.
- **Métricas de redes conectadas** não entram no prompt. Não existe tabela de snapshot de métricas: os números vêm ao vivo do `SocialAnalyticsService` (com cache). O Brain só agrega contagens de `social_posts` (publicados/falhos/formatos), sem engajamento por canal.
- A camada de **agentes** (`runAgent` em `src/lib/ai-agents.functions.ts`) já faz blueprint de marca, checagem de acesso, orçamento (`check_ai_usage_budget`), log de custo em `ai_jobs` e possui os agentes `pauta.suggest` e `content.generate` — mas a Pauta não passa por ela.

## O que vamos fazer

### 1. Contexto de Estratégia IA (novo)

Novo módulo `src/lib/monthly-plan-strategy.server.ts`:

- Lê os blocos ativos (`is_active = true`) de voice / personas / cohorts / swot do cliente.
- Condensa em markdown enxuto: tom e do/don't do voice card, 2-3 personas (dor, desejo, gancho), cohorts com `content_strategy`, e as oportunidades/ameaças do SWOT.
- Retorna também metadados (`generatedAt`, quais blocos existem) para exibir na UI.
- Se não houver estratégia ativa, retorna vazio (não bloqueia a geração).

### 2. Contexto de desempenho por canal (novo)

Novo módulo `src/lib/monthly-plan-performance.server.ts`:

- Descobre as contas conectadas do cliente (`social_connections`) e, para cada canal selecionado no wizard, busca via `SocialAnalyticsService` (nunca chamando provider direto): visão geral do último período e top posts.
- Deriva por canal: melhores formatos por engajamento, média de engajamento, temas dos posts de melhor desempenho, e o que teve baixo desempenho.
- Complementa com o histórico interno de `social_posts` (formatos publicados, falhas) quando a API não responder.
- Blindagem obrigatória: timeout curto por canal, execução em paralelo, cache existente reutilizado e `try/catch` — falha de API vira "métricas indisponíveis para este canal", nunca erro na geração.

### 3. Geração via camada de agentes

- `generateMonthlyPlanFn` passa a usar `runAgent({ agent: "pauta.suggest" })` e `regenerateTopicFn` usa `content.generate`, mantendo os schemas e o fallback de parse atuais.
- Ganhos automáticos: blueprint de marca, verificação de acesso, controle de orçamento e registro de custo/modelo em `ai_jobs` (a pauta passa a aparecer nos logs de IA como os outros fluxos).
- O prompt final fica em ordem de prioridade explícita: Estratégia IA ativa → Briefing → Desempenho real por canal → Brain → cotas/formatos do wizard, com instrução de que cada ideia deve citar a persona/cohort alvo e o motivo baseado em dados.

### 4. Rastreabilidade e UI

- Cada tópico gerado guarda a persona/cohort alvo e a justificativa (`rationale`) — migração adicionando as colunas em `monthly_plan_topics` (nullable, com GRANTs), exibidas no card do tópico.
- `monthly_plans` guarda quais fontes foram usadas (estratégia vX, canais com métricas, contagem de documentos).
- No wizard (passo 1) e no cabeçalho da pauta: selo com as fontes cruzadas — "Estratégia IA de {data}", "Métricas: Instagram, Facebook", "Briefing completo" — e aviso quando a estratégia ativa não existe (com link para gerar) ou quando um canal está sem conta conectada.

## Detalhes técnicos

- Módulos novos são `*.server.ts` puros (recebem `SupabaseClient`), importados apenas dentro dos handlers das server functions.
- Sem chamada a Graph API direta: tudo via `SocialAnalyticsService`.
- Limites de tamanho por seção do prompt para não estourar contexto (estratégia ~4k, desempenho ~2k, briefing 12k como hoje).
- Nada muda no cálculo de volumetria, no fluxo de aprovação interna/cliente nem no schema do JSON de saída da IA além dos dois campos novos por tópico.

é importante que cada pauta gerada e aprovada vire um projeto no cliente
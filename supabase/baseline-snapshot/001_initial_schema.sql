-- =============================================================================
-- 001_initial_schema.sql — SNAPSHOT ESTRUTURAL DO ESTADO ATUAL APROVADO
--
-- Gerado por pg_dump --schema-only (estado real do banco) e REORDENADO por
-- tools/reorder_schema.py para ordem de dependencia executavel em um projeto
-- Supabase NOVO e vazio, via psql OU `supabase db query --linked`.
--
-- Ordem interna: schema -> enums/types -> tabelas -> funcoes -> matviews ->
-- defaults -> constraints (PK/UNIQUE/CHECK) -> FKs -> indices -> triggers ->
-- RLS -> policies -> comments -> grants.
--
-- Nenhuma DDL foi alterada, removida ou adicionada: apenas a ordem dos
-- statements. Meta-comandos do psql (\restrict/\unrestrict) e SETs de sessao
-- foram removidos por incompatibilidade com `supabase db query`.
--
-- NAO contem: DML de seed/backfill, dados de producao, cron jobs, buckets e
-- policies de Storage, trigger em auth.users. Ver 000/002/003/004/005/006.
-- =============================================================================


-- Bodies de funcoes nao sao validados: o dump nao garante ordem
-- topologica entre funcoes que chamam outras funcoes. Objetos que
-- exigem validacao real (defaults, CHECK, indices, policies) sao
-- criados DEPOIS das funcoes, portanto continuam sendo verificados.
SET check_function_bodies = false;


-- ============================ SCHEMA / EXTENSIONS (2) ============================

CREATE SCHEMA IF NOT EXISTS public;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


-- ============================ TYPES / ENUMS (10) ============================

--
-- Name: alert_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_severity AS ENUM (
    'info',
    'warning',
    'critical'
);

--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'owner',
    'manager',
    'editor',
    'designer',
    'client',
    'user',
    'admin'
);

--
-- Name: approval_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.approval_status AS ENUM (
    'pending',
    'approved',
    'changes_requested',
    'adjust',
    'rejected'
);

--
-- Name: calendar_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.calendar_event_type AS ENUM (
    'appointment',
    'seasonal'
);

--
-- Name: notification_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_kind AS ENUM (
    'mention',
    'assignment',
    'approval_requested',
    'approval_decision',
    'deadline',
    'system',
    'sla_overdue',
    'sla_overdue_manager'
);

--
-- Name: post_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.post_channel AS ENUM (
    'instagram',
    'tiktok',
    'linkedin',
    'x',
    'youtube',
    'blog'
);

--
-- Name: post_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.post_stage AS ENUM (
    'idea',
    'production',
    'review',
    'approved',
    'scheduled',
    'published'
);

--
-- Name: project_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_status AS ENUM (
    'planning',
    'in_progress',
    'active',
    'paused',
    'done',
    'archived'
);

--
-- Name: task_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_priority AS ENUM (
    'low',
    'medium',
    'high',
    'urgent'
);

--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'todo',
    'in_progress',
    'review',
    'done'
);


-- ============================ TABLES / SEQUENCES (89) ============================

--
-- Name: activity_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid,
    actor_id uuid,
    entity_type text NOT NULL,
    entity_id uuid,
    verb text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: agent_prompt_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_prompt_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    agent_id text NOT NULL,
    system_prompt text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: agent_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_prompts (
    agent_id text NOT NULL,
    agent_name text NOT NULL,
    system_prompt text NOT NULL,
    required_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    default_prompt text NOT NULL,
    brain_enabled boolean DEFAULT true NOT NULL
);

--
-- Name: ai_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    subtitle text,
    status text DEFAULT 'queued'::text NOT NULL,
    progress smallint DEFAULT 0 NOT NULL,
    step_label text,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    error text,
    target_route text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: ai_model_catalog_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_model_catalog_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    role text NOT NULL,
    model_id text NOT NULL,
    replaced_model_id text,
    reason text,
    source text DEFAULT 'auto_health_check'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: ai_model_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_model_health (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    status text NOT NULL,
    error_message text,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'operational'::text NOT NULL,
    CONSTRAINT ai_model_health_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'failed'::text])))
);

--
-- Name: ai_usage_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    scope text NOT NULL,
    client_id uuid,
    user_id uuid,
    period text DEFAULT 'monthly'::text NOT NULL,
    limit_usd numeric(12,4) NOT NULL,
    hard_stop boolean DEFAULT true NOT NULL,
    notify_at_pct integer DEFAULT 80 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_usage_limits_limit_usd_check CHECK ((limit_usd >= (0)::numeric)),
    CONSTRAINT ai_usage_limits_notify_at_pct_check CHECK (((notify_at_pct >= 1) AND (notify_at_pct <= 100))),
    CONSTRAINT ai_usage_limits_period_check CHECK ((period = 'monthly'::text)),
    CONSTRAINT ai_usage_limits_scope_check CHECK ((scope = ANY (ARRAY['brand'::text, 'client'::text, 'user'::text]))),
    CONSTRAINT ai_usage_limits_scope_shape CHECK ((((scope = 'brand'::text) AND (client_id IS NULL) AND (user_id IS NULL)) OR ((scope = 'client'::text) AND (client_id IS NOT NULL) AND (user_id IS NULL)) OR ((scope = 'user'::text) AND (user_id IS NOT NULL))))
);

--
-- Name: brain_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    event_id uuid,
    content_summary text NOT NULL,
    embedding public.vector(1536),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brain_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    event_type text NOT NULL,
    source_module text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    outcome_score numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    entity_type text,
    entity_id uuid,
    action text,
    client_id uuid,
    project_id uuid,
    confidence numeric,
    correlation_id uuid,
    processed_at timestamp with time zone
);

--
-- Name: brain_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    insight_type text NOT NULL,
    description text NOT NULL,
    confidence numeric,
    based_on_events integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    client_id uuid,
    scope text DEFAULT 'brand'::text NOT NULL,
    CONSTRAINT brain_insights_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'brand'::text, 'client'::text])))
);

--
-- Name: brain_learning_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_learning_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    brand_id uuid,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brain_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    subject_type text,
    subject_id uuid,
    memory_type text NOT NULL,
    scope text DEFAULT 'brand'::text NOT NULL,
    key text NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence numeric(4,3) DEFAULT 0.500 NOT NULL,
    decay_rate numeric(4,3) DEFAULT 0.000 NOT NULL,
    access_count integer DEFAULT 0 NOT NULL,
    last_accessed_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_type text,
    entity_id uuid,
    category text,
    title text,
    description text,
    source_event uuid,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    relations jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    origin text DEFAULT 'system'::text NOT NULL,
    previous_confidence numeric(4,3),
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    reinforcement_count integer DEFAULT 0 NOT NULL,
    contradiction_count integer DEFAULT 0 NOT NULL,
    client_id uuid,
    last_observed_at timestamp with time zone,
    CONSTRAINT brain_memory_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT brain_memory_memory_type_check CHECK ((memory_type = ANY (ARRAY['short_term'::text, 'long_term'::text, 'episodic'::text, 'semantic'::text, 'pattern'::text, 'preference'::text, 'fact'::text]))),
    CONSTRAINT brain_memory_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'brand'::text, 'client'::text])))
);

--
-- Name: brain_memory_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_memory_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    memory_id uuid NOT NULL,
    brand_id uuid,
    version integer NOT NULL,
    confidence numeric(4,3) NOT NULL,
    previous_confidence numeric(4,3),
    delta_confidence numeric(5,3),
    title text,
    description text,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    relations jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    change_reason text,
    source_event uuid,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brain_metrics_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_metrics_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    channel text,
    metric_name text NOT NULL,
    metric_value numeric NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brain_reasoning_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_reasoning_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    client_id uuid,
    user_id uuid,
    conversation_id uuid,
    question text NOT NULL,
    intent text NOT NULL,
    intent_confidence numeric,
    plan jsonb DEFAULT '[]'::jsonb NOT NULL,
    tools_used jsonb DEFAULT '[]'::jsonb NOT NULL,
    decision text NOT NULL,
    used_llm boolean DEFAULT false NOT NULL,
    answer_confidence numeric,
    latency_ms integer,
    memory_hits integer DEFAULT 0 NOT NULL,
    answer_preview text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brain_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    client_id uuid,
    target_user_id uuid,
    recommendation_type text NOT NULL,
    title text NOT NULL,
    description text,
    action_payload jsonb DEFAULT '{}'::jsonb,
    priority text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    confidence numeric(4,3) DEFAULT 0.500 NOT NULL,
    source_insight_id uuid,
    source_event_ids uuid[] DEFAULT ARRAY[]::uuid[],
    expires_at timestamp with time zone,
    acted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brain_recommendations_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT brain_recommendations_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT brain_recommendations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'shown'::text, 'accepted'::text, 'dismissed'::text, 'expired'::text])))
);

--
-- Name: brain_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    from_type text NOT NULL,
    from_id uuid NOT NULL,
    to_type text NOT NULL,
    to_id uuid NOT NULL,
    relationship_type text NOT NULL,
    strength numeric(4,3) DEFAULT 0.500 NOT NULL,
    confidence numeric(4,3) DEFAULT 0.500 NOT NULL,
    bidirectional boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    observation_count integer DEFAULT 1 NOT NULL,
    last_observed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid,
    CONSTRAINT brain_relationships_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT brain_relationships_strength_check CHECK (((strength >= (0)::numeric) AND (strength <= (1)::numeric)))
);

--
-- Name: brain_retention_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_retention_config (
    key text NOT NULL,
    value_days integer NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    color text DEFAULT '#8b5cf6'::text,
    logo_url text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cpf text,
    cnpj text,
    nome_fantasia text,
    razao_social text,
    cep text,
    rua text,
    numero text,
    complemento text,
    bairro text,
    cidade text,
    estado text,
    logo_dark_url text,
    icon_url text,
    login_logo_url text,
    app_url text,
    is_active boolean DEFAULT true NOT NULL,
    inactivated_at timestamp with time zone
);

--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    project_id uuid,
    title text NOT NULL,
    copy text DEFAULT ''::text,
    channels public.post_channel[] DEFAULT '{}'::public.post_channel[] NOT NULL,
    stage public.post_stage DEFAULT 'idea'::public.post_stage NOT NULL,
    scheduled_at timestamp with time zone,
    published_at timestamp with time zone,
    assignee_id uuid,
    cover_url text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pipeline_id uuid,
    stage_id uuid,
    "position" integer DEFAULT 0 NOT NULL,
    review_status text DEFAULT 'pending'::text NOT NULL,
    reference_media jsonb DEFAULT '[]'::jsonb NOT NULL,
    design_brief text,
    ai_phase text DEFAULT 'idea'::text NOT NULL,
    approved_at timestamp with time zone,
    approved_by uuid,
    deleted_at timestamp with time zone,
    rework_notes text,
    priority text DEFAULT 'normal'::text,
    format text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    visible_in_portal boolean DEFAULT true NOT NULL,
    internal_briefing text,
    client_briefing text,
    script jsonb DEFAULT '[]'::jsonb,
    "references" jsonb DEFAULT '[]'::jsonb NOT NULL,
    remind_at timestamp with time zone,
    recurrence jsonb,
    assignees uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    stage_entered_at timestamp with time zone DEFAULT now(),
    target_connection_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    monthly_plan_topic_id uuid,
    ai_phase_at timestamp with time zone,
    CONSTRAINT posts_format_canonical CHECK (((format IS NULL) OR (format = ANY (ARRAY['feed'::text, 'stories'::text, 'reels'::text, 'carrossel'::text]))))
);

--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid,
    name text NOT NULL,
    description text,
    status public.project_status DEFAULT 'planning'::public.project_status NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    due_at timestamp with time zone,
    owner_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    color text,
    start_date timestamp with time zone,
    goals text,
    monthly_plan_id uuid,
    CONSTRAINT projects_progress_check CHECK (((progress >= 0) AND (progress <= 100)))
);

--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid,
    project_id uuid,
    title text NOT NULL,
    description text,
    status public.task_status DEFAULT 'todo'::public.task_status NOT NULL,
    priority public.task_priority DEFAULT 'medium'::public.task_priority NOT NULL,
    assignee_id uuid,
    due_at timestamp with time zone,
    done boolean DEFAULT false NOT NULL,
    done_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    job_id uuid,
    estimated_minutes integer,
    total_minutes integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    post_id uuid,
    archived_at timestamp with time zone
);

--
-- Name: brain_worker_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brain_worker_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_name text DEFAULT 'brain_learning_worker'::text NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    duration_ms integer,
    picked integer DEFAULT 0 NOT NULL,
    processed integer DEFAULT 0 NOT NULL,
    discarded integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    memories_created integer DEFAULT 0 NOT NULL,
    memories_updated integer DEFAULT 0 NOT NULL,
    insights_created integer DEFAULT 0 NOT NULL,
    edges_created integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brand_ai_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_ai_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    post_id uuid,
    pauta_id uuid,
    plataforma text,
    formato text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL
);

--
-- Name: brand_ai_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_ai_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    agent text NOT NULL,
    model text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,6) DEFAULT 0 NOT NULL,
    success boolean DEFAULT true NOT NULL,
    error_message text,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid
);

--
-- Name: brand_ai_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_ai_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    data jsonb NOT NULL,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL
);

--
-- Name: brand_api_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_api_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    provider text NOT NULL,
    ciphertext text NOT NULL,
    masked text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brand_briefing_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_briefing_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    base_version_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text,
    submitted_via text DEFAULT 'portal_session'::text NOT NULL,
    submitted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brand_briefing_proposals_via_chk CHECK ((submitted_via = ANY (ARRAY['portal_session'::text, 'portal_token'::text])))
);

--
-- Name: brand_briefing_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_briefing_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    requested_fields text[] DEFAULT '{}'::text[] NOT NULL,
    message text,
    status text DEFAULT 'requested'::text NOT NULL,
    base_version_id uuid,
    due_at timestamp with time zone,
    requested_by uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    canceled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_fields text[] DEFAULT '{}'::text[] NOT NULL,
    pending_fields text[] DEFAULT '{}'::text[] NOT NULL,
    review_decision text,
    review_note text,
    promoted_version_id uuid,
    decided_at timestamp with time zone,
    decided_by uuid,
    CONSTRAINT brand_briefing_requests_decision_chk CHECK (((review_decision IS NULL) OR (review_decision = ANY (ARRAY['approved'::text, 'partial'::text, 'changes_requested'::text])))),
    CONSTRAINT brand_briefing_requests_status_chk CHECK ((status = ANY (ARRAY['requested'::text, 'submitted'::text, 'in_review'::text, 'approved'::text])))
);

--
-- Name: brand_briefing_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_briefing_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    proposal_id uuid,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    decision text NOT NULL,
    accepted_fields text[] DEFAULT '{}'::text[] NOT NULL,
    pending_fields text[] DEFAULT '{}'::text[] NOT NULL,
    promoted jsonb DEFAULT '{}'::jsonb NOT NULL,
    note text,
    version_id uuid,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brand_briefing_reviews_decision_chk CHECK ((decision = ANY (ARRAY['approved'::text, 'partial'::text, 'changes_requested'::text])))
);

--
-- Name: brand_briefing_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_briefing_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    completion integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    origin text DEFAULT 'manual'::text NOT NULL,
    changed_fields text[] DEFAULT '{}'::text[] NOT NULL,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brand_briefings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_briefings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    raw_text text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    completude integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL
);

--
-- Name: brand_cohorts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_cohorts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL
);

--
-- Name: brand_competitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_competitors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    handle text,
    bio_colada text,
    posts_colados text,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    pautas_inspiradas jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL
);

--
-- Name: brand_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_connections (
    brand_id uuid NOT NULL,
    monthly_budget_usd numeric DEFAULT 500 NOT NULL,
    text_provider text DEFAULT 'openai'::text NOT NULL,
    image_provider text DEFAULT 'gemini'::text NOT NULL,
    providers jsonb DEFAULT '{}'::jsonb NOT NULL,
    channels jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    text_fallback_provider text
);

--
-- Name: brand_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    feature_key text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    enabled_at timestamp with time zone,
    enabled_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: brand_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    email text NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    token text NOT NULL,
    invited_by uuid NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    temp_password_sent boolean DEFAULT false NOT NULL
);

--
-- Name: brand_journey_stage_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_journey_stage_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    stage text NOT NULL,
    project_template_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brand_journey_stage_templates_stage_check CHECK ((stage = ANY (ARRAY['onboarding'::text, 'ativacao'::text, 'operacao'::text, 'expansao'::text, 'renovacao'::text])))
);

--
-- Name: brand_media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    uploaded_by uuid,
    storage_path text NOT NULL,
    name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint DEFAULT 0 NOT NULL,
    kind text NOT NULL,
    width integer,
    height integer,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid,
    CONSTRAINT brand_media_assets_kind_check CHECK ((kind = ANY (ARRAY['image'::text, 'video'::text, 'other'::text])))
);

--
-- Name: brand_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    deactivated_at timestamp with time zone,
    deactivated_by uuid,
    CONSTRAINT brand_members_role_official_chk CHECK ((role = ANY (ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'user'::public.app_role, 'client'::public.app_role])))
);

--
-- Name: brand_pautas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_pautas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    titulo text NOT NULL,
    pilar text,
    cohort_alvo text,
    formato_recomendado text,
    plataforma text,
    gancho text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL,
    status text DEFAULT 'backlog'::text NOT NULL,
    pilar_type text,
    formato text
);

--
-- Name: brand_personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_personas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL
);

--
-- Name: brand_swot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_swot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL
);

--
-- Name: brand_voice_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_voice_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL
);

--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    client_id uuid,
    type public.calendar_event_type NOT NULL,
    title text NOT NULL,
    description text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    all_day boolean DEFAULT false NOT NULL,
    is_global boolean DEFAULT false NOT NULL,
    color text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_events_scope_ck CHECK ((((is_global = true) AND (brand_id IS NULL)) OR ((is_global = false) AND (brand_id IS NOT NULL)))),
    CONSTRAINT calendar_events_seasonal_global_ck CHECK (((is_global = false) OR (type = 'seasonal'::public.calendar_event_type)))
);

--
-- Name: card_approval_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_approval_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    token_id uuid,
    brand_id uuid NOT NULL,
    verb text NOT NULL,
    comment text,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: card_approval_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_approval_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: chat_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    brand_id uuid,
    client_id uuid,
    title text DEFAULT 'Nova conversa'::text NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    brain_context jsonb,
    used_llm boolean DEFAULT false NOT NULL,
    model text,
    tokens_in integer,
    tokens_out integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tool_calls jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))
);

--
-- Name: client_briefing_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_briefing_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    token text NOT NULL,
    label text,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    submitted_at timestamp with time zone,
    submission jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: client_briefings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_briefings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    personas jsonb DEFAULT '[]'::jsonb,
    target_audience text,
    hashtags text[] DEFAULT '{}'::text[],
    monthly_volume integer DEFAULT 0,
    guidelines text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: client_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_status text DEFAULT 'idle'::text NOT NULL,
    ai_model text,
    ai_error text,
    extracted_text text,
    ai_summary jsonb,
    analyzed_at timestamp with time zone,
    applied_to_briefing_at timestamp with time zone,
    visible_to_client boolean DEFAULT false NOT NULL,
    CONSTRAINT client_documents_ai_status_chk CHECK ((ai_status = ANY (ARRAY['idle'::text, 'queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);

--
-- Name: client_journey_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_journey_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    from_stage text,
    to_stage text NOT NULL,
    note text,
    project_id uuid,
    moved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: client_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'editor'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    last_seen_at timestamp with time zone
);

--
-- Name: client_social_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_social_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    name text NOT NULL,
    niche text,
    color text DEFAULT '#6366f1'::text,
    contact_name text,
    contact_email text,
    contact_phone text,
    tone_of_voice text,
    palette jsonb DEFAULT '[]'::jsonb,
    socials jsonb DEFAULT '[]'::jsonb,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    owner_user_id uuid,
    logo_url text,
    logo_secondary_url text,
    favicon_url text,
    brand_hub jsonb DEFAULT '{}'::jsonb NOT NULL,
    website text,
    address text,
    monthly_contract_value numeric(12,2),
    margin_percent numeric(5,2),
    contract_start_date date,
    contract_renewal_date date,
    contract_status text DEFAULT 'ativo'::text NOT NULL,
    internal_notes text,
    journey_stage text DEFAULT 'onboarding'::text NOT NULL,
    portal_theme jsonb DEFAULT '{"mode": "system"}'::jsonb NOT NULL,
    legal_name text,
    cnpj text,
    description text,
    briefing_status text DEFAULT 'draft'::text NOT NULL,
    briefing_status_at timestamp with time zone,
    briefing_status_by uuid,
    CONSTRAINT clients_briefing_status_check CHECK ((briefing_status = ANY (ARRAY['draft'::text, 'requested'::text, 'submitted'::text, 'in_review'::text, 'approved'::text]))),
    CONSTRAINT clients_contract_status_check CHECK ((contract_status = ANY (ARRAY['ativo'::text, 'pausado'::text, 'encerrado'::text]))),
    CONSTRAINT clients_journey_stage_check CHECK ((journey_stage = ANY (ARRAY['onboarding'::text, 'ativacao'::text, 'operacao'::text, 'expansao'::text, 'renovacao'::text])))
);

--
-- Name: content_pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    color text DEFAULT 'muted'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_terminal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hide_in_portal boolean DEFAULT false NOT NULL,
    enables_approval_link boolean DEFAULT false NOT NULL,
    sla_days integer,
    sla_hours integer
);

--
-- Name: content_pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    color text,
    description text,
    icon text
);

--
-- Name: evolution_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evolution_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    instance_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid,
    instance_name text NOT NULL,
    event_type text NOT NULL,
    provider_event_id text,
    connection_state text,
    phone_number text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: evolution_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evolution_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid,
    instance_name text NOT NULL,
    label text,
    status text DEFAULT 'created'::text NOT NULL,
    connection_state text,
    phone_number text,
    last_state_at timestamp with time zone,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    webhook_token text,
    webhook_configured_at timestamp with time zone,
    last_event_at timestamp with time zone
);

--
-- Name: feature_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    icon text,
    is_core boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    default_enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: installation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.installation (
    id boolean DEFAULT true NOT NULL,
    app_url text,
    logo_url text,
    logo_dark_url text,
    icon_url text,
    login_logo_url text,
    email_from text,
    email_from_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT installation_singleton_chk CHECK (id)
);

--
-- Name: media_plan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_plan_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    product_service text,
    campaign_type text,
    funnel_stage text,
    objective text,
    main_kpi text,
    channel text,
    audience text,
    budget_pct numeric(6,2) DEFAULT 0 NOT NULL,
    budget_amount numeric(14,2) DEFAULT 0 NOT NULL,
    keywords text[] DEFAULT ARRAY[]::text[] NOT NULL,
    benchmark text,
    other_refs text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT media_plan_items_funnel_stage_check CHECK ((funnel_stage = ANY (ARRAY['topo'::text, 'meio'::text, 'fundo'::text])))
);

--
-- Name: media_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    title text DEFAULT 'Plano de mídia'::text NOT NULL,
    period_start date,
    period_end date,
    monthly_budget numeric(14,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    share_token text,
    share_expires_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT media_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'archived'::text])))
);

--
-- Name: message_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    channel text NOT NULL,
    status text NOT NULL,
    provider_message_id text,
    recipient text,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    failed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid
);

--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    event_key text NOT NULL,
    channel text NOT NULL,
    subject text,
    body text DEFAULT ''::text NOT NULL,
    variables_used text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_templates_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text])))
);

--
-- Name: meta_compliance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_compliance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    meta_user_id text NOT NULL,
    confirmation_code text NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    affected_connections integer DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meta_compliance_events_event_type_check CHECK ((event_type = ANY (ARRAY['deauthorize'::text, 'data_deletion'::text])))
);

--
-- Name: meta_oauth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_oauth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    user_id uuid NOT NULL,
    meta_user_id text NOT NULL,
    meta_user_name text,
    meta_user_email text,
    user_token_ciphertext text NOT NULL,
    user_token_expires_at timestamp with time zone,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pages jsonb DEFAULT '[]'::jsonb NOT NULL,
    consumed_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    threads_accounts jsonb DEFAULT '[]'::jsonb NOT NULL,
    ad_accounts jsonb DEFAULT '[]'::jsonb NOT NULL,
    requested_scopes text[] DEFAULT ARRAY[]::text[] NOT NULL,
    portfolio_loaded_at timestamp with time zone,
    portfolio_load_status text DEFAULT 'not_loaded'::text NOT NULL,
    portfolio_error text,
    portfolio_rate_limited_until timestamp with time zone,
    portfolio_source_session_id uuid,
    CONSTRAINT meta_oauth_sessions_portfolio_load_status_check CHECK ((portfolio_load_status = ANY (ARRAY['not_loaded'::text, 'loaded'::text, 'empty'::text, 'error'::text, 'rate_limited'::text])))
);

--
-- Name: monthly_plan_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_plan_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    monthly_plan_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: monthly_plan_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_plan_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    monthly_plan_id uuid NOT NULL,
    topic_title text NOT NULL,
    content_format text,
    angle text,
    status text DEFAULT 'pending'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    channel text,
    previous_title text,
    previous_angle text,
    target_audience text,
    rationale text,
    client_status text DEFAULT 'pending'::text NOT NULL,
    client_comment text,
    client_decision_at timestamp with time zone,
    CONSTRAINT monthly_plan_topics_content_format_canonical CHECK (((content_format IS NULL) OR (content_format = ANY (ARRAY['feed'::text, 'stories'::text, 'reels'::text, 'carrossel'::text])))),
    CONSTRAINT monthly_plan_topics_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

--
-- Name: monthly_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    input_theme text,
    input_briefing_id uuid,
    title text NOT NULL,
    description text,
    objectives text,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL,
    internal_approved_at timestamp with time zone,
    internal_approved_by uuid,
    client_decision_at timestamp with time zone,
    client_feedback text,
    context_sources jsonb DEFAULT '{}'::jsonb NOT NULL,
    project_id uuid,
    client_decision_mode text,
    CONSTRAINT monthly_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_client'::text, 'client_approved'::text, 'changes_requested'::text, 'approved'::text, 'archived'::text])))
);

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    kind public.notification_kind NOT NULL,
    title text NOT NULL,
    body text,
    href text,
    read_at timestamp with time zone,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    dedupe_key text,
    archived_at timestamp with time zone
);

--
-- Name: plan_overage_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_overage_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    channel text NOT NULL,
    period_month date NOT NULL,
    quota integer DEFAULT 0 NOT NULL,
    requested integer DEFAULT 0 NOT NULL,
    overage integer DEFAULT 0 NOT NULL,
    justification text,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plan_overage_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

--
-- Name: portal_rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_rate_limit (
    ip_hash text NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL,
    fail_count integer DEFAULT 0 NOT NULL,
    blocked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: portal_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    token text NOT NULL,
    label text,
    revoked_at timestamp with time zone,
    expires_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: post_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    status public.approval_status DEFAULT 'pending'::public.approval_status NOT NULL,
    notes text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_by_name text
);

--
-- Name: post_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid NOT NULL,
    format text NOT NULL,
    scheduled_at timestamp with time zone,
    copy_override jsonb,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp with time zone,
    external_ref text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    connection_id uuid,
    CONSTRAINT post_placements_format_check CHECK ((format = ANY (ARRAY['feed'::text, 'stories'::text, 'reels'::text, 'carrossel'::text]))),
    CONSTRAINT post_placements_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'published'::text, 'failed'::text])))
);

--
-- Name: project_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    color text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: project_template_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_template_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    color text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: project_template_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_template_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_job_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    priority text,
    estimated_minutes integer,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: project_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    name text NOT NULL,
    description text,
    icon text,
    is_system boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: sla_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sla_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    scope text NOT NULL,
    scope_ref text,
    project_id uuid,
    target_hours integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sla_rules_scope_check CHECK ((scope = ANY (ARRAY['project'::text, 'user_role'::text, 'agent'::text]))),
    CONSTRAINT sla_rules_target_hours_check CHECK ((target_hours > 0))
);

--
-- Name: social_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    provider text NOT NULL,
    external_id text NOT NULL,
    external_name text,
    account_id text,
    account_username text,
    owner_external_id text,
    owner_name text,
    access_token_ciphertext text NOT NULL,
    refresh_token_ciphertext text,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    token_expires_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    last_error text,
    last_synced_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    channel text NOT NULL,
    client_id uuid,
    page_id text,
    instagram_business_id text,
    meta_user_id text,
    channel_name text,
    CONSTRAINT social_connections_channel_check CHECK ((channel = ANY (ARRAY['instagram'::text, 'facebook'::text, 'linkedin'::text, 'tiktok'::text, 'youtube'::text, 'x'::text, 'threads'::text, 'ads'::text]))),
    CONSTRAINT social_connections_provider_check CHECK ((provider = ANY (ARRAY['meta'::text, 'instagram'::text, 'facebook'::text, 'tiktok'::text, 'youtube'::text, 'linkedin'::text, 'twitter'::text, 'threads'::text]))),
    CONSTRAINT social_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'error'::text, 'expired'::text, 'revoked'::text])))
);

--
-- Name: social_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid,
    connection_id uuid NOT NULL,
    provider text NOT NULL,
    placement text DEFAULT 'feed'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    caption text,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    hashtags text[] DEFAULT '{}'::text[] NOT NULL,
    mentions text[] DEFAULT '{}'::text[] NOT NULL,
    scheduled_at timestamp with time zone,
    published_at timestamp with time zone,
    external_post_id text,
    external_permalink text,
    last_error text,
    provider_response jsonb DEFAULT '{}'::jsonb NOT NULL,
    post_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    publish_attempts integer DEFAULT 0 NOT NULL,
    publish_locked_at timestamp with time zone,
    location_id text,
    CONSTRAINT social_posts_placement_check CHECK ((placement = ANY (ARRAY['feed'::text, 'story'::text, 'reel'::text, 'carousel'::text, 'short'::text, 'tweet'::text, 'thread'::text, 'post'::text]))),
    CONSTRAINT social_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'publishing'::text, 'published'::text, 'failed'::text, 'cancelled'::text, 'blocked'::text])))
);

--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    mentions uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: task_subtasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_subtasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    title text NOT NULL,
    done boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: task_time_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_time_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    minutes integer,
    description text,
    is_rework boolean DEFAULT false NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    seconds integer,
    ended_reason text,
    CONSTRAINT task_time_entries_source_check CHECK ((source = ANY (ARRAY['timer'::text, 'manual'::text])))
);

--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    avatar_url text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    requires_password_change boolean DEFAULT false NOT NULL,
    phone text,
    timezone text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
    locale text DEFAULT 'pt-BR'::text NOT NULL,
    job_title text,
    bio text,
    is_super_admin boolean DEFAULT false NOT NULL,
    whatsapp text,
    notify_whatsapp boolean DEFAULT false NOT NULL,
    notification_prefs jsonb DEFAULT '{"ai_jobs": true, "comments": true, "approvals": true, "deadlines": true, "assignments": true}'::jsonb NOT NULL,
    CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'user'::text, 'super_admin'::text])))
);

--
-- Name: whatsapp_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    client_id uuid,
    user_id uuid,
    type text NOT NULL,
    name text NOT NULL,
    role_label text,
    destination text,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_recipients_client_required CHECK (((type <> ALL (ARRAY['client_contact'::text, 'account_manager'::text, 'whatsapp_group'::text])) OR (client_id IS NOT NULL))),
    CONSTRAINT whatsapp_recipients_destination_required CHECK ((((type = ANY (ARRAY['client_contact'::text, 'whatsapp_group'::text])) AND (destination IS NOT NULL) AND (length(btrim(destination)) > 0)) OR ((type = ANY (ARRAY['account_manager'::text, 'workspace_admin'::text, 'workspace_user'::text])) AND (destination IS NULL)))),
    CONSTRAINT whatsapp_recipients_group_jid CHECK (((type <> 'whatsapp_group'::text) OR (destination ~ '^[0-9]+(-[0-9]+)?@g\.us$'::text))),
    CONSTRAINT whatsapp_recipients_phone_digits CHECK (((type <> 'client_contact'::text) OR (destination ~ '^[0-9]{10,15}$'::text))),
    CONSTRAINT whatsapp_recipients_type_check CHECK ((type = ANY (ARRAY['client_contact'::text, 'account_manager'::text, 'workspace_admin'::text, 'workspace_user'::text, 'whatsapp_group'::text]))),
    CONSTRAINT whatsapp_recipients_user_required CHECK (((type <> 'workspace_user'::text) OR (user_id IS NOT NULL)))
);


-- ============================ FUNCTIONS (133) ============================

--
-- Name: _brain_cfg_days(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._brain_cfg_days(_key text, _default integer) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE((SELECT value_days FROM public.brain_retention_config WHERE key = _key), _default);
$$;

--
-- Name: _portal_session(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._portal_session(_token text) RETURNS TABLE(client_id uuid, brand_id uuid, token_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
BEGIN
  SELECT pt.id, pt.client_id, pt.revoked_at, pt.expires_at, pt.last_seen_at, c.brand_id
    INTO r
    FROM public.portal_tokens pt
    JOIN public.clients c ON c.id = pt.client_id
   WHERE pt.token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'token_revoked'; END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at < now() THEN RAISE EXCEPTION 'token_expired'; END IF;
  IF r.last_seen_at IS NULL OR r.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE public.portal_tokens SET last_seen_at = now() WHERE id = r.id;
  END IF;
  client_id := r.client_id; brand_id := r.brand_id; token_id := r.id;
  RETURN NEXT;
END $$;

--
-- Name: _portal_session_any(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._portal_session_any(_token text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid) RETURNS TABLE(client_id uuid, brand_id uuid, token_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF _token IS NULL OR length(trim(_token)) = 0 THEN
    RETURN QUERY SELECT * FROM public._portal_session_user(_client_id);
  ELSE
    RETURN QUERY SELECT * FROM public._portal_session(_token);
  END IF;
END $$;

--
-- Name: _portal_session_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._portal_session_user(_client_id uuid DEFAULT NULL::uuid) RETURNS TABLE(client_id uuid, brand_id uuid, token_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE r record; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;

  IF _client_id IS NOT NULL THEN
    SELECT cm.id, cm.client_id, cm.brand_id, cm.last_seen_at
      INTO r
      FROM public.client_members cm
     WHERE cm.user_id = uid AND cm.role = 'portal_client' AND cm.client_id = _client_id
     LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'client_not_allowed'; END IF;
  ELSE
    SELECT cm.id, cm.client_id, cm.brand_id, cm.last_seen_at
      INTO r
      FROM public.client_members cm
     WHERE cm.user_id = uid AND cm.role = 'portal_client'
     ORDER BY cm.last_seen_at DESC NULLS LAST, cm.created_at
     LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  END IF;

  IF r.last_seen_at IS NULL OR r.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE public.client_members SET last_seen_at = now() WHERE id = r.id;
  END IF;
  client_id := r.client_id; brand_id := r.brand_id; token_id := NULL;
  RETURN NEXT;
END $$;

--
-- Name: accept_brand_invite(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_brand_invite(_token text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
  v_invite public.brand_invites%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_invite FROM public.brand_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invite_revoked'; END IF;
  IF v_invite.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'invite_already_accepted'; END IF;
  IF v_invite.expires_at < now() THEN RAISE EXCEPTION 'invite_expired'; END IF;
  IF lower(v_invite.email) <> v_user_email THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;

  IF v_invite.role NOT IN ('owner', 'admin', 'manager', 'user') THEN
    RAISE EXCEPTION 'invite_role_not_allowed';
  END IF;

  IF v_invite.invited_by = v_user_id AND NOT public.is_super_admin(v_user_id) THEN
    RAISE EXCEPTION 'invite_self_escalation';
  END IF;

  IF NOT public.can_invite_brand_role(
        v_invite.brand_id, v_invite.invited_by, v_invite.role, v_invite.email) THEN
    RAISE EXCEPTION 'invite_authority_invalid';
  END IF;

  INSERT INTO public.brand_members (brand_id, user_id, role, permissions)
  VALUES (v_invite.brand_id, v_user_id, v_invite.role, v_invite.permissions)
  ON CONFLICT (brand_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;

  UPDATE public.brand_invites SET accepted_at = now(), accepted_by = v_user_id WHERE id = v_invite.id;
  RETURN v_invite.brand_id;
END;
$$;

--
-- Name: add_brand_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_brand_owner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.brand_members (brand_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'owner')
    ON CONFLICT (brand_id, user_id) DO UPDATE SET role = 'owner';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: app_access_role(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid DEFAULT NULL::uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL
    WHEN public.is_super_admin(_user_id) THEN 'super_admin'
    WHEN _brand_id IS NULL THEN (
      SELECT 'client'
        FROM public.client_members cm
       WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
       LIMIT 1
    )
    ELSE COALESCE(
      (SELECT CASE bm.role
                WHEN 'owner'   THEN 'admin'
                WHEN 'admin'   THEN 'admin'
                WHEN 'manager' THEN 'manager'
                WHEN 'client'  THEN 'client'
                ELSE 'user'
              END
         FROM public.brand_members bm
        WHERE bm.user_id = _user_id
          AND bm.is_active
          AND bm.brand_id = _brand_id
        ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3
                              WHEN 'client' THEN 5 ELSE 4 END,
                 bm.user_id
        LIMIT 1),
      (SELECT 'client'
         FROM public.client_members cm
        WHERE cm.user_id = _user_id AND cm.role = 'portal_client'
        LIMIT 1)
    )
  END;
$$;

--
-- Name: block_unusable_scheduled_social_posts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_unusable_scheduled_social_posts() RETURNS TABLE(id uuid, reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
  v_reason text;
BEGIN
  FOR r IN
    SELECT sp.id, sp.client_id, sp.brand_id, sp.connection_id,
           sc.id AS conn_id, sc.status AS conn_status, sc.access_token_ciphertext
      FROM public.social_posts sp
      LEFT JOIN public.social_connections sc
             ON sc.id = sp.connection_id AND sc.brand_id = sp.brand_id
     WHERE sp.status = 'scheduled'
       AND sp.scheduled_at IS NOT NULL
       AND sp.scheduled_at <= now()
       AND (sp.publish_locked_at IS NULL OR sp.publish_locked_at < now() - interval '10 minutes')
  LOOP
    v_reason := NULL;
    IF r.conn_id IS NULL THEN
      v_reason := 'connection_missing';
    ELSIF r.conn_status <> 'active' THEN
      v_reason := 'connection_inactive';
    ELSIF r.access_token_ciphertext IS NULL THEN
      v_reason := 'token_invalid';
    ELSIF r.client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.client_social_accounts csa
       WHERE csa.connection_id = r.connection_id
         AND csa.client_id = r.client_id
         AND csa.brand_id = r.brand_id
    ) THEN
      v_reason := 'client_account_link_missing';
    END IF;

    IF v_reason IS NOT NULL THEN
      PERFORM public.mark_social_post_blocked(
        r.id,
        CASE v_reason
          WHEN 'connection_missing' THEN 'Conexão indisponível: esta conta não está mais conectada a este workspace.'
          WHEN 'connection_inactive' THEN 'Conta desconectada. Reconecte a conta em Canais para publicar.'
          WHEN 'token_invalid' THEN 'Autorização expirada. Reconecte a conta em Canais para publicar.'
          ELSE 'Conta não vinculada a este cliente. Vincule em Perfil do cliente > Canais.'
        END,
        'connection_required'
      );
      RETURN QUERY SELECT r.id, v_reason;
    END IF;
  END LOOP;
END;
$$;

--
-- Name: brain_cleanup_ttl(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_cleanup_ttl() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  q_days int := public._brain_cfg_days('brain_learning_queue_done_days', 7);
  f_days int := public._brain_cfg_days('brain_learning_queue_failed_days', 30);
  i_days int := public._brain_cfg_days('brain_insights_expired_days', 30);
  r_days int := public._brain_cfg_days('brain_recommendations_done_days', 30);
  m_days int := public._brain_cfg_days('brain_metrics_snapshots_days', 730);
  v_days int := public._brain_cfg_days('brain_memory_versions_days', 365);
  q_del int; f_del int; i_del int; r_del int; m_del int; v_del int;
  emb_orphans int; lq_orphans int;
BEGIN
  WITH d AS (DELETE FROM public.brain_learning_queue
              WHERE status IN ('done','processed','skipped')
                AND COALESCE(processed_at, updated_at) < now() - (q_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO q_del FROM d;
  WITH d AS (DELETE FROM public.brain_learning_queue
              WHERE status IN ('failed','dead')
                AND COALESCE(processed_at, updated_at) < now() - (f_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO f_del FROM d;
  WITH d AS (DELETE FROM public.brain_insights
              WHERE expires_at IS NOT NULL
                AND expires_at < now() - (i_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO i_del FROM d;
  WITH d AS (DELETE FROM public.brain_recommendations
              WHERE status IN ('dismissed','completed','expired')
                AND updated_at < now() - (r_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO r_del FROM d;
  WITH d AS (DELETE FROM public.brain_metrics_snapshots
              WHERE created_at < now() - (m_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO m_del FROM d;
  WITH d AS (DELETE FROM public.brain_memory_versions
              WHERE created_at < now() - (v_days || ' days')::interval
              RETURNING 1) SELECT count(*) INTO v_del FROM d;
  WITH d AS (
    DELETE FROM public.brain_embeddings e
     WHERE e.event_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.brain_events ev WHERE ev.id = e.event_id)
    RETURNING 1) SELECT count(*) INTO emb_orphans FROM d;
  WITH d AS (
    DELETE FROM public.brain_learning_queue lq
     WHERE lq.event_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.brain_events ev WHERE ev.id = lq.event_id)
    RETURNING 1) SELECT count(*) INTO lq_orphans FROM d;

  RETURN jsonb_build_object(
    'learning_queue_done', q_del, 'learning_queue_failed', f_del,
    'insights_expired', i_del,
    'recommendations_done', r_del, 'metrics_snapshots', m_del,
    'memory_versions', v_del, 'embeddings_orphans', emb_orphans,
    'learning_queue_orphans', lq_orphans);
END $$;

--
-- Name: brain_confidence(integer, numeric, timestamp with time zone, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_confidence(_sample integer, _consistency numeric, _last_observed timestamp with time zone, _relevance numeric DEFAULT 1.0) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT GREATEST(0.05, LEAST(0.95, round(
      ( 0.45 * (GREATEST(_sample,0)::numeric / (GREATEST(_sample,0) + 4))
      + 0.35 * LEAST(GREATEST(COALESCE(_consistency,0), 0), 1)
      + 0.20 * exp(-ln(2.0) * (LEAST(GREATEST(EXTRACT(EPOCH FROM (now() - COALESCE(_last_observed, now())))/86400.0, 0), 3650) / 45.0))
      ) * LEAST(GREATEST(COALESCE(_relevance,1), 0), 1)
  , 3)));
$$;

--
-- Name: brain_events_guard_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_events_guard_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _sensitive text[] := ARRAY[
    'role','roles','app_role','app_roles','access_role','is_super_admin','super_admin',
    'is_admin','actor_id','actor','auth','auth_uid','uid','claims','jwt','token','tokens',
    'access_token','refresh_token','id_token','api_key','apikey','authorization','bearer',
    'password','secret','service_role','permissions','scopes','scope_override','impersonate'
  ];
  _k text;
  _ok boolean;
BEGIN
  -- Integridade estrutural do par workspace/cliente (vale para qualquer caller).
  IF NEW.client_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = NEW.client_id
         AND NEW.brand_id IS NOT NULL
         AND c.brand_id = NEW.brand_id
    ) INTO _ok;
    IF NOT _ok THEN
      RAISE EXCEPTION 'brain_events: par brand/client inconsistente';
    END IF;
  END IF;

  -- service_role / workers legítimos (sem sessão): evento de sistema preservado.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Usuário autenticado: identidade autoritativa do servidor.
  NEW.actor_id := _uid;

  IF NEW.payload IS NULL THEN
    NEW.payload := '{}'::jsonb;
  ELSIF jsonb_typeof(NEW.payload) = 'object' THEN
    FOREACH _k IN ARRAY _sensitive LOOP
      IF NEW.payload ? _k THEN
        NEW.payload := NEW.payload - _k;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: brain_events_prune(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_events_prune() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  hot_days int := public._brain_cfg_days('brain_events_hot_days', 90);
  cutoff timestamptz := now() - (hot_days || ' days')::interval;
  deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.brain_events WHERE created_at < cutoff RETURNING 1
  ) SELECT count(*) INTO deleted FROM d;
  RETURN jsonb_build_object('deleted', deleted, 'cutoff', cutoff);
END $$;

--
-- Name: brain_memory_decay_and_archive(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_memory_decay_and_archive() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE archived integer;
BEGIN
  WITH upd AS (
    UPDATE public.brain_memory
       SET status = 'archived'
     WHERE status = 'active'
       AND (
         (confidence < 0.15 AND updated_at < now() - interval '14 days')
         OR (last_accessed_at IS NOT NULL AND last_accessed_at < now() - interval '180 days' AND confidence < 0.4)
         OR (expires_at IS NOT NULL AND expires_at < now())
       )
    RETURNING 1
  )
  SELECT count(*) INTO archived FROM upd;
  RETURN archived;
END $$;

--
-- Name: brain_memory_evolve(uuid, text, uuid, text, text, text, jsonb, numeric, text, uuid, text[], jsonb, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_memory_evolve(_brand_id uuid, _entity_type text, _entity_id uuid, _category text, _title text, _description text DEFAULT NULL::text, _content jsonb DEFAULT '{}'::jsonb, _evidence_confidence numeric DEFAULT 0.6, _origin text DEFAULT 'system'::text, _source_event uuid DEFAULT NULL::uuid, _tags text[] DEFAULT '{}'::text[], _relations jsonb DEFAULT '[]'::jsonb, _metadata jsonb DEFAULT '{}'::jsonb, _contradicts boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  existing public.brain_memory%ROWTYPE;
  new_conf numeric;
  new_id uuid;
  ev_weight numeric := 0.35;
  ref_entry jsonb;
  v_client uuid;
BEGIN
  IF _brand_id IS NOT NULL AND NOT (public.is_brand_member(_brand_id, auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_client := CASE WHEN _entity_type = 'client' THEN _entity_id ELSE NULL END;

  SELECT * INTO existing
    FROM public.brain_memory
   WHERE COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND entity_type = _entity_type
     AND entity_id   = _entity_id
     AND category    = _category
     AND title       = _title
   LIMIT 1;

  ref_entry := jsonb_build_object('at', to_jsonb(now()), 'source_event', _source_event,
    'origin', _origin, 'evidence', _evidence_confidence, 'contradicts', _contradicts);

  IF FOUND THEN
    IF _contradicts THEN
      new_conf := GREATEST(0.02, existing.confidence - (ev_weight * _evidence_confidence));
    ELSE
      new_conf := LEAST(0.99, (1.0 - ev_weight) * existing.confidence + ev_weight * _evidence_confidence);
    END IF;

    UPDATE public.brain_memory SET
      description = COALESCE(_description, description),
      content     = content || COALESCE(_content, '{}'::jsonb),
      confidence  = ROUND(new_conf, 3),
      client_id   = COALESCE(client_id, v_client),
      tags        = ARRAY(SELECT DISTINCT unnest(tags || COALESCE(_tags, '{}'))),
      relations   = COALESCE(relations, '[]'::jsonb) || COALESCE(_relations, '[]'::jsonb),
      metadata    = metadata || COALESCE(_metadata, '{}'::jsonb),
      source_refs = COALESCE(source_refs, '[]'::jsonb) || jsonb_build_array(ref_entry),
      reinforcement_count = reinforcement_count + CASE WHEN _contradicts THEN 0 ELSE 1 END,
      contradiction_count = contradiction_count + CASE WHEN _contradicts THEN 1 ELSE 0 END,
      status      = CASE WHEN existing.status = 'archived' AND NOT _contradicts THEN 'active' ELSE existing.status END,
      source_event = COALESCE(_source_event, source_event),
      origin       = COALESCE(existing.origin, _origin)
    WHERE id = existing.id;

    RETURN existing.id;
  END IF;

  INSERT INTO public.brain_memory
    (brand_id, client_id, memory_type, scope, key, content, confidence,
     entity_type, entity_id, category, title, description,
     source_event, tags, relations, metadata, status,
     version, origin, source_refs, reinforcement_count)
  VALUES
    (_brand_id, v_client, 'pattern',
     CASE WHEN v_client IS NOT NULL THEN 'client'
          WHEN _brand_id IS NULL THEN 'global' ELSE 'brand' END,
     COALESCE(_entity_type,'entity') || ':' || COALESCE(_entity_id::text,'-') || ':' || COALESCE(_category,'general'),
     COALESCE(_content, '{}'::jsonb),
     ROUND(LEAST(0.95, GREATEST(0.05, _evidence_confidence))::numeric, 3),
     _entity_type, _entity_id, _category, _title, _description,
     _source_event, COALESCE(_tags, '{}'), COALESCE(_relations, '[]'::jsonb),
     COALESCE(_metadata, '{}'::jsonb), 'active',
     1, _origin, jsonb_build_array(ref_entry), 1)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

--
-- Name: brain_memory_guard_scope(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_memory_guard_scope(_brand_id uuid, _client_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- service_role (workers) não tem auth.uid(): mantém acesso irrestrito.
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF public.is_super_admin(auth.uid()) THEN RETURN; END IF;
  IF _brand_id IS NULL OR NOT public.is_brand_member(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _client_id IS NOT NULL AND NOT public.can_access_client(_client_id, auth.uid()) THEN
    RAISE EXCEPTION 'client_out_of_scope' USING ERRCODE = '42501';
  END IF;
END $$;

--
-- Name: brain_memory_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_memory_snapshot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  changed boolean := false;
  reason text := NULL;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    changed :=
      OLD.content    IS DISTINCT FROM NEW.content
   OR OLD.confidence IS DISTINCT FROM NEW.confidence
   OR OLD.title       IS DISTINCT FROM NEW.title
   OR OLD.description IS DISTINCT FROM NEW.description
   OR OLD.status      IS DISTINCT FROM NEW.status
   OR OLD.tags        IS DISTINCT FROM NEW.tags
   OR OLD.relations   IS DISTINCT FROM NEW.relations;

    IF NOT changed THEN
      RETURN NEW;
    END IF;

    IF OLD.confidence IS DISTINCT FROM NEW.confidence THEN
      reason := CASE WHEN NEW.confidence > OLD.confidence THEN 'reinforced'
                     WHEN NEW.confidence < OLD.confidence THEN 'weakened'
                     ELSE 'updated' END;
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      reason := 'status_change';
    ELSE
      reason := 'content_update';
    END IF;

    NEW.previous_confidence := OLD.confidence;
    NEW.version    := COALESCE(OLD.version, 1) + 1;
    NEW.updated_at := now();

    INSERT INTO public.brain_memory_versions
      (memory_id, brand_id, version, confidence, previous_confidence, delta_confidence,
       title, description, content, tags, relations, metadata, status, change_reason,
       source_event, changed_by)
    VALUES
      (OLD.id, OLD.brand_id, OLD.version, OLD.confidence, OLD.previous_confidence,
       (NEW.confidence - OLD.confidence),
       OLD.title, OLD.description, OLD.content, OLD.tags, OLD.relations, OLD.metadata,
       OLD.status, reason, OLD.source_event, auth.uid());
  END IF;
  RETURN NEW;
END $$;

--
-- Name: brain_memory_touch(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_memory_touch(_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.brain_memory
       SET access_count = access_count + 1,
           last_accessed_at = now()
     WHERE id = ANY(_ids)
       AND (brand_id IS NULL
            OR public.is_brand_member(brand_id, auth.uid())
            OR public.is_super_admin(auth.uid()))
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $$;

--
-- Name: brain_mine_patterns(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_mine_patterns(_brand_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
  v_created integer := 0;
  v_updated integer := 0;
  v_global  integer := 0;
  v_archived integer := 0;
  v_skipped integer := 0;
  v_evidence integer := 0;
  v_id uuid;
  v_new boolean;
  v_conf numeric;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('brain_mine_patterns')) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'locked');
  END IF;

  -- 1) DESEMPENHO POR CANAL (MARCA)
  FOR r IN
    WITH per_channel AS (
      SELECT s.brand_id, s.channel,
             SUM(CASE WHEN s.metric_name = 'reach' THEN s.metric_value ELSE 0 END)      AS reach,
             SUM(CASE WHEN s.metric_name = 'engagement' THEN s.metric_value ELSE 0 END) AS engagement,
             COUNT(*) AS measurements,
             MAX(s.period_end) AS last_seen
        FROM public.brain_metrics_snapshots s
       WHERE s.metric_name IN ('reach','engagement')
         AND s.brand_id IS NOT NULL AND s.channel IS NOT NULL
         AND s.period_start >= (now() - interval '120 days')::date
         AND (_brand_id IS NULL OR s.brand_id = _brand_id)
       GROUP BY s.brand_id, s.channel
      HAVING SUM(CASE WHEN s.metric_name = 'reach' THEN s.metric_value ELSE 0 END) > 0
    ), flagged AS (
      SELECT p.*,
             COUNT(*) FILTER (WHERE p.engagement > 0) OVER (PARTITION BY p.brand_id) AS eng_channels
        FROM per_channel p
    ), rated AS (
      SELECT brand_id, channel, reach, engagement, measurements, last_seen, eng_channels,
             CASE WHEN eng_channels >= 2 THEN 'interacao' ELSE 'alcance' END AS basis,
             CASE WHEN eng_channels >= 2 THEN engagement / NULLIF(reach,0) ELSE reach END AS metric
        FROM flagged
       WHERE eng_channels < 2 OR engagement > 0
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY brand_id ORDER BY metric DESC) rn,
             COUNT(*) OVER (PARTITION BY brand_id) channels,
             SUM(measurements) OVER (PARTITION BY brand_id) total_measurements,
             MAX(metric) OVER (PARTITION BY brand_id) best,
             MIN(metric) OVER (PARTITION BY brand_id) worst
        FROM rated
    )
    SELECT * FROM ranked
     WHERE rn = 1 AND channels >= 2 AND total_measurements >= 4 AND best > worst
  LOOP
    v_evidence := v_evidence + r.total_measurements;
    v_conf := public.brain_confidence(
      r.total_measurements::int,
      COALESCE((r.best - r.worst) / NULLIF(r.best,0), 0),
      r.last_seen::timestamptz,
      CASE WHEN r.basis = 'interacao' THEN 1.0 ELSE 0.8 END);

    INSERT INTO public.brain_memory(
      brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
      entity_type, entity_id, category, title, description, content, confidence,
      reinforcement_count, origin, status, tags, metadata, last_observed_at)
    VALUES (
      r.brand_id, NULL, 'brand', r.brand_id, 'pattern', 'brand',
      'brand:' || r.brand_id || ':canal_de_maior_desempenho',
      'brand', r.brand_id, 'desempenho_por_canal',
      'Canal de maior desempenho',
      CASE WHEN r.basis = 'interacao'
        THEN 'Para esta marca, ' || r.channel || ' apresenta a maior taxa média de interação ('
             || round(r.metric * 100, 2) || '% em ' || r.total_measurements
             || ' medições / 120 dias, ' || r.channels || ' canais comparados).'
        ELSE 'Para esta marca, ' || r.channel || ' concentra o maior alcance medido ('
             || round(r.metric) || ' em ' || r.total_measurements || ' medições / 120 dias, '
             || r.channels || ' canais comparados). Interação ainda não medida em 2+ canais.'
      END,
      jsonb_build_object('top_channel', r.channel, 'basis', r.basis,
                         'metric', round(r.metric,5), 'sample', r.total_measurements,
                         'channels', r.channels, 'window_days', 120,
                         'reach', r.reach, 'engagement', r.engagement),
      v_conf, 1, 'mining', 'active',
      ARRAY['performance','channel','pattern']::text[],
      jsonb_build_object('miner','channel_performance'), r.last_seen::timestamptz)
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 entity_type, entity_id, category, title)
    DO UPDATE SET
      previous_confidence = public.brain_memory.confidence,
      confidence  = EXCLUDED.confidence,
      description = EXCLUDED.description,
      content     = EXCLUDED.content,
      reinforcement_count = public.brain_memory.reinforcement_count + 1,
      last_observed_at = EXCLUDED.last_observed_at,
      status = 'active', updated_at = now()
    RETURNING id, (public.brain_memory.previous_confidence IS NULL) INTO v_id, v_new;
    IF COALESCE(v_new, true) THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
  END LOOP;

  -- 2) DESEMPENHO POR FORMATO (MARCA): aprovação / ajuste (rework) / rejeição.
  --    'pending' nunca conta como resultado.
  FOR r IN
    WITH per_format AS (
      SELECT p.brand_id, public.canonical_content_format(p.format) AS fmt,
             COUNT(*) AS n,
             COUNT(*) FILTER (WHERE p.review_status = 'approved'
                                 OR p.approved_at IS NOT NULL) AS approved,
             COUNT(*) FILTER (WHERE p.review_status IN ('rework','changes_requested')
                                 OR COALESCE(p.rework_notes,'') <> '') AS rework,
             COUNT(*) FILTER (WHERE p.review_status = 'rejected') AS rejected,
             MAX(GREATEST(p.updated_at, p.created_at)) AS last_seen
        FROM public.posts p
       WHERE p.format IS NOT NULL AND p.deleted_at IS NULL
         AND p.created_at >= now() - interval '180 days'
         AND (_brand_id IS NULL OR p.brand_id = _brand_id)
       GROUP BY p.brand_id, public.canonical_content_format(p.format)
      HAVING COUNT(*) >= 4
    ), rated AS (
      SELECT *, (approved::numeric - rework::numeric - rejected::numeric) / NULLIF(n,0) AS score
        FROM per_format
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY brand_id ORDER BY score DESC) rn,
             COUNT(*) OVER (PARTITION BY brand_id) formats,
             SUM(n)   OVER (PARTITION BY brand_id) total,
             SUM(approved + rework + rejected) OVER (PARTITION BY brand_id) outcome_signals,
             MAX(score) OVER (PARTITION BY brand_id) best,
             MIN(score) OVER (PARTITION BY brand_id) worst
        FROM rated
    )
    SELECT * FROM ranked
     WHERE rn = 1 AND formats >= 2 AND outcome_signals >= 3 AND best > worst
  LOOP
    v_evidence := v_evidence + r.outcome_signals;
    v_conf := public.brain_confidence(
      r.outcome_signals::int,
      COALESCE((r.best - r.worst) / NULLIF(ABS(r.best) + 1, 0), 0),
      r.last_seen);

    INSERT INTO public.brain_memory(
      brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
      entity_type, entity_id, category, title, description, content, confidence,
      reinforcement_count, origin, status, tags, metadata, last_observed_at)
    VALUES (
      r.brand_id, NULL, 'brand', r.brand_id, 'pattern', 'brand',
      'brand:' || r.brand_id || ':formato_de_melhor_aprovacao',
      'brand', r.brand_id, 'desempenho_por_formato',
      'Formato com melhor aprovação',
      'O formato ' || r.fmt || ' é o que passa com menos retrabalho ('
        || r.approved || ' aprovados, ' || r.rework || ' com ajustes e '
        || r.rejected || ' rejeitados em ' || r.n
        || ' peças; ' || r.formats || ' formatos comparados / 180 dias).',
      jsonb_build_object('top_format', r.fmt, 'score', round(r.score,3),
                         'sample', r.outcome_signals, 'pieces', r.total,
                         'formats', r.formats, 'approved', r.approved,
                         'rework', r.rework, 'rejected', r.rejected,
                         'window_days', 180),
      v_conf, 1, 'mining', 'active',
      ARRAY['performance','format','pattern']::text[],
      jsonb_build_object('miner','format_performance'), r.last_seen)
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 entity_type, entity_id, category, title)
    DO UPDATE SET
      previous_confidence = public.brain_memory.confidence,
      confidence  = EXCLUDED.confidence,
      description = EXCLUDED.description,
      content     = EXCLUDED.content,
      reinforcement_count = public.brain_memory.reinforcement_count + 1,
      last_observed_at = EXCLUDED.last_observed_at,
      status = 'active', updated_at = now()
    RETURNING id, (public.brain_memory.previous_confidence IS NULL) INTO v_id, v_new;
    IF COALESCE(v_new, true) THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
  END LOOP;

  -- 3) MIX DE CANAIS DO CLIENTE (CLIENTE)
  FOR r IN
    WITH exploded AS (
      SELECT p.brand_id, p.client_id, unnest(p.channels)::text AS ch,
             GREATEST(p.published_at, p.updated_at) AS seen
        FROM public.posts p
       WHERE p.client_id IS NOT NULL AND p.channels IS NOT NULL
         AND p.deleted_at IS NULL
         AND p.created_at >= now() - interval '180 days'
         AND (_brand_id IS NULL OR p.brand_id = _brand_id)
    ), agg AS (
      SELECT brand_id, client_id, ch, COUNT(*) n, MAX(seen) last_seen
        FROM exploded GROUP BY brand_id, client_id, ch
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY brand_id, client_id ORDER BY n DESC) rn,
             SUM(n)   OVER (PARTITION BY brand_id, client_id) total,
             COUNT(*) OVER (PARTITION BY brand_id, client_id) channels,
             MAX(n)   OVER (PARTITION BY brand_id, client_id) best,
             MIN(n)   OVER (PARTITION BY brand_id, client_id) worst
        FROM agg
    )
    SELECT * FROM ranked WHERE rn = 1 AND total >= 6 AND channels >= 2 AND best > worst
  LOOP
    v_evidence := v_evidence + r.total;
    v_conf := public.brain_confidence(
      r.total::int, (r.best::numeric / NULLIF(r.total,0)), r.last_seen);

    INSERT INTO public.brain_memory(
      brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
      entity_type, entity_id, category, title, description, content, confidence,
      reinforcement_count, origin, status, tags, metadata, last_observed_at)
    VALUES (
      r.brand_id, r.client_id, 'client', r.client_id, 'pattern', 'client',
      'client:' || r.client_id || ':mix_de_canais',
      'client', r.client_id, 'mix_de_canais',
      'Mix de canais do cliente',
      'A produção deste cliente concentra-se em ' || r.ch || ' ('
        || round(100.0 * r.best / GREATEST(r.total,1), 0) || '% de ' || r.total
        || ' peças em ' || r.channels || ' canais / 180 dias).',
      jsonb_build_object('top_channel', r.ch, 'share', round(r.best::numeric / GREATEST(r.total,1), 3),
                         'sample', r.total, 'channels', r.channels, 'window_days', 180),
      v_conf, 1, 'mining', 'active',
      ARRAY['channel','mix','client']::text[],
      jsonb_build_object('miner','client_channel_mix'), r.last_seen)
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 entity_type, entity_id, category, title)
    DO UPDATE SET
      previous_confidence = public.brain_memory.confidence,
      confidence  = EXCLUDED.confidence,
      description = EXCLUDED.description,
      content     = EXCLUDED.content,
      client_id   = EXCLUDED.client_id,
      reinforcement_count = public.brain_memory.reinforcement_count + 1,
      last_observed_at = EXCLUDED.last_observed_at,
      status = 'active', updated_at = now()
    RETURNING id, (public.brain_memory.previous_confidence IS NULL) INTO v_id, v_new;
    IF COALESCE(v_new, true) THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
  END LOOP;

  -- 4) PROMOÇÃO GLOBAL (inalterada)
  FOR r IN
    SELECT m.content->>'top_channel' AS ch,
           COUNT(DISTINCT m.brand_id) AS brands,
           round(AVG((m.content->>'metric')::numeric), 5) AS avg_metric,
           MAX(m.last_observed_at) AS last_seen
      FROM public.brain_memory m
     WHERE m.category = 'desempenho_por_canal'
       AND m.scope = 'brand' AND m.status = 'active'
       AND m.client_id IS NULL
       AND m.content ? 'top_channel'
       AND m.content->>'basis' = 'interacao'
     GROUP BY 1
    HAVING COUNT(DISTINCT m.brand_id) >= 3
  LOOP
    INSERT INTO public.brain_memory(
      brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
      entity_type, entity_id, category, title, description, content, confidence,
      reinforcement_count, origin, status, tags, metadata, last_observed_at)
    VALUES (
      NULL, NULL, 'global', NULL, 'pattern', 'global',
      'global:canal_de_maior_desempenho:' || r.ch,
      'global', md5('global:channel:' || r.ch)::uuid, 'desempenho_por_canal_global',
      'Tendência agregada de canal',
      'Em dados agregados de ' || r.brands || ' marcas, ' || r.ch
        || ' aparece como canal de maior taxa de interação (média '
        || round(r.avg_metric*100,2) || '%).',
      jsonb_build_object('top_channel', r.ch, 'brands', r.brands,
                         'avg_metric', r.avg_metric, 'sample', r.brands, 'aggregated', true),
      public.brain_confidence(r.brands::int, 0.6, r.last_seen), 1, 'mining', 'active',
      ARRAY['performance','channel','global']::text[],
      jsonb_build_object('miner','global_promotion','identifiable', false), r.last_seen)
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 entity_type, entity_id, category, title)
    DO UPDATE SET
      previous_confidence = public.brain_memory.confidence,
      confidence  = EXCLUDED.confidence,
      description = EXCLUDED.description,
      content     = EXCLUDED.content,
      last_observed_at = EXCLUDED.last_observed_at,
      status = 'active', updated_at = now();
    v_global := v_global + 1;
  END LOOP;

  -- 5) DESCARTE: baixa relevância OU padrão sem nenhum sinal de resultado
  WITH low AS (
    UPDATE public.brain_memory m
       SET status = 'archived',
           metadata = COALESCE(m.metadata,'{}'::jsonb)
                      || jsonb_build_object('archived_reason', CASE
                            WHEN COALESCE((m.content->>'approved')::int,0) = 0
                             AND COALESCE((m.content->>'rework')::int,0) = 0
                             AND COALESCE((m.content->>'rejected')::int,0) = 0
                              THEN 'no_outcome_signal'
                            ELSE 'low_relevance' END)
     WHERE m.status = 'active'
       AND m.origin IN ('learning','mining','consolidation')
       AND (
         (m.category = 'desempenho_por_formato'
           AND COALESCE((m.content->>'approved')::int,0) = 0
           AND COALESCE((m.content->>'rework')::int,0) = 0
           AND COALESCE((m.content->>'rejected')::int,0) = 0)
         OR (m.confidence < 0.20
             AND COALESCE((m.content->>'sample')::int, 0) < 3
             AND COALESCE(m.last_observed_at, m.updated_at) < now() - interval '30 days')
       )
    RETURNING 1)
  SELECT COUNT(*) INTO v_archived FROM low;

  RETURN jsonb_build_object('memories_created', v_created, 'memories_updated', v_updated,
                            'global_promoted', v_global, 'archived_low_relevance', v_archived,
                            'skipped_patterns', v_skipped, 'evidence_processed', v_evidence);
END;
$$;

--
-- Name: brain_render_memory_desc(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_render_memory_desc(_category text, _content jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE _category
    WHEN 'padrao_de_aprovacao' THEN
      'Aprovações diretas: ' || COALESCE(_content->>'approved','0') ||
      ' · Ajustes solicitados: ' || COALESCE(_content->>'adjust','0') ||
      ' · Rejeições: ' || COALESCE(_content->>'rejected','0') ||
      ' (amostra de ' || COALESCE(_content->>'sample','0') || ' decisões).'
    WHEN 'cadencia_de_publicacao' THEN
      'Publicações concluídas registradas: ' || COALESCE(_content->>'published','0') ||
      ' (amostra de ' || COALESCE(_content->>'sample','0') || ' eventos).'
    WHEN 'riscos_operacionais' THEN
      'Incidentes registrados (atrasos/falhas): ' || COALESCE(_content->>'incident','0') ||
      ' (amostra de ' || COALESCE(_content->>'sample','0') || ' eventos).'
    ELSE 'Aprendizado consolidado (amostra de ' || COALESCE(_content->>'sample','0') || ' evidências).'
  END;
$$;

--
-- Name: brain_retention_run(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_retention_run() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a jsonb; b jsonb;
BEGIN
  a := public.brain_events_prune();
  b := public.brain_cleanup_ttl();
  RETURN jsonb_build_object('events', a, 'ttl', b, 'ran_at', now());
END $$;

--
-- Name: brain_run_mining_safe(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_run_mining_safe() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v jsonb;
  v_run uuid;
  v_err text := NULL;
  v_started timestamptz := now();
BEGIN
  INSERT INTO public.brain_worker_runs (job_name, status, started_at)
  VALUES ('brain_pattern_mining', 'running', v_started)
  RETURNING id INTO v_run;

  BEGIN
    v := public.brain_mine_patterns(NULL);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    v := jsonb_build_object('error', v_err);
  END;

  UPDATE public.brain_worker_runs
     SET status = CASE
                    WHEN v_err IS NOT NULL THEN 'failed'
                    WHEN COALESCE((v->>'skipped')::boolean, false) THEN 'skipped'
                    ELSE 'succeeded' END,
         finished_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - v_started)) * 1000)::int),
         processed = COALESCE((v->>'evidence_processed')::int, 0),
         memories_created = COALESCE((v->>'memories_created')::int, 0),
         memories_updated = COALESCE((v->>'memories_updated')::int, 0),
         discarded = COALESCE((v->>'archived_low_relevance')::int, 0),
         insights_created = COALESCE((v->>'global_promoted')::int, 0),
         failed = CASE WHEN v_err IS NOT NULL THEN 1 ELSE 0 END,
         error = v_err
   WHERE id = v_run;

  RETURN v || jsonb_build_object('run_id', v_run);
END;
$$;

--
-- Name: brain_scope_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_scope_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    NEW.scope := 'client';
  ELSIF NEW.brand_id IS NOT NULL THEN
    NEW.scope := 'brand';
  ELSE
    NEW.scope := 'global';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: brain_set_last_observed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_set_last_observed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.last_observed_at IS NULL THEN
    NEW.last_observed_at := COALESCE(
      NULLIF(NEW.content->>'last_event_at','')::timestamptz,
      NULLIF(NEW.content->>'last_seen_at','')::timestamptz,
      NEW.updated_at,
      now());
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: brain_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

--
-- Name: brain_trg_client_documents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_trg_client_documents() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.emit_brain_event(
    NEW.brand_id, 'file.uploaded', 'documents', auth.uid(),
    'document', NEW.id, 'created', NEW.client_id, NULL,
    jsonb_build_object('file_name', NEW.name)
  );
  RETURN NEW;
END; $$;

--
-- Name: brain_trg_clients(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_trg_clients() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_type text;
BEGIN
  v_type := CASE WHEN TG_OP = 'INSERT' THEN 'customer.created' ELSE 'customer.updated' END;
  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'customers', auth.uid(),
    'customer', NEW.id, lower(TG_OP), NEW.id, NULL,
    jsonb_build_object('name', NEW.name)
  );
  RETURN NEW;
END; $$;

--
-- Name: brain_trg_post_approvals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_trg_post_approvals() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_brand uuid; v_client uuid;
BEGIN
  SELECT brand_id, client_id INTO v_brand, v_client FROM public.posts WHERE id = NEW.post_id;
  PERFORM public.emit_brain_event(
    v_brand, 'content.approval', 'approvals', NEW.decided_by,
    'post_approval', NEW.id, COALESCE(NEW.status::text, 'reviewed'), v_client, NULL,
    jsonb_build_object(
      'post_id', NEW.post_id,
      'status', NEW.status,
      'notes', NEW.notes,
      'decided_by_name', NEW.decided_by_name,
      'decided_at', NEW.decided_at
    )
  );
  RETURN NEW;
END; $$;

--
-- Name: brain_trg_posts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_trg_posts() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_action text; v_type text; v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created'; v_type := 'content.created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      v_action := 'stage_changed'; v_type := 'content.stage_changed';
    ELSE
      v_action := 'updated'; v_type := 'content.updated';
    END IF;
  END IF;

  v_payload := jsonb_build_object(
    'stage_id', NEW.stage_id,
    'title', NEW.title,
    'review_status', NEW.review_status,
    'review_notes', NEW.rework_notes
  );

  IF TG_OP = 'UPDATE' THEN
    v_payload := v_payload || jsonb_build_object(
      'previous_review_status', OLD.review_status,
      'review_status_changed', (NEW.review_status IS DISTINCT FROM OLD.review_status)
    );
    IF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
      v_payload := v_payload || jsonb_build_object('decision', NEW.review_status);
    END IF;
  END IF;

  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'content', auth.uid(),
    'post', NEW.id, v_action, NEW.client_id, NULL,
    v_payload
  );
  RETURN NEW;
END; $$;

--
-- Name: brain_trg_projects(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_trg_projects() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_action text; v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN v_action := 'created'; v_type := 'project.created';
  ELSE v_action := 'updated'; v_type := 'project.updated';
  END IF;
  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'projects', auth.uid(),
    'project', NEW.id, v_action, NEW.client_id, NEW.id,
    jsonb_build_object('status', NEW.status, 'name', NEW.name)
  );
  RETURN NEW;
END; $$;

--
-- Name: brain_trg_task_comments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_trg_task_comments() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_brand uuid; v_client uuid; v_project uuid;
BEGIN
  SELECT brand_id, client_id, project_id INTO v_brand, v_client, v_project
  FROM public.tasks WHERE id = NEW.task_id;
  PERFORM public.emit_brain_event(
    v_brand, 'comment.created', 'tasks', NEW.author_id,
    'task_comment', NEW.id, 'created', v_client, v_project,
    jsonb_build_object('task_id', NEW.task_id)
  );
  RETURN NEW;
END; $$;

--
-- Name: brain_trg_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brain_trg_tasks() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_action text; v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created'; v_type := 'task.created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'status_changed';
      v_type := CASE WHEN NEW.status = 'done' THEN 'task.completed' ELSE 'task.updated' END;
    ELSE
      v_action := 'updated'; v_type := 'task.updated';
    END IF;
  END IF;
  PERFORM public.emit_brain_event(
    NEW.brand_id, v_type, 'tasks', auth.uid(),
    'task', NEW.id, v_action, NEW.client_id, NEW.project_id,
    jsonb_build_object('status', NEW.status, 'priority', NEW.priority, 'title', NEW.title)
  );
  RETURN NEW;
END; $$;

--
-- Name: brand_member_role(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.brand_member_role(_user_id uuid, _brand_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT bm.role::text
    FROM public.brand_members bm
   WHERE bm.user_id = _user_id
     AND bm.brand_id = _brand_id
     AND bm.is_active
   ORDER BY CASE bm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3
                         WHEN 'client' THEN 5 ELSE 4 END
   LIMIT 1;
$$;

--
-- Name: bump_chat_conversation_last_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_chat_conversation_last_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.chat_conversations
    SET last_message_at = NEW.created_at,
        updated_at = now()
    WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

--
-- Name: calendar_events_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calendar_events_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

--
-- Name: can_access_client(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_client(_client_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_brand uuid;
  v_owner uuid;
  v_found boolean := false;
BEGIN
  IF _client_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT true, brand_id, owner_user_id INTO v_found, v_brand, v_owner
    FROM public.clients WHERE id = _client_id;

  -- Cliente inexistente nunca autoriza (nem super admin): IDs forjados
  -- devem falhar de forma idêntica a IDs fora do escopo.
  IF NOT COALESCE(v_found, false) THEN
    RETURN false;
  END IF;

  RETURN public.can_access_client_row(_client_id, v_brand, v_owner, _user_id);
END;
$$;

--
-- Name: can_access_client_row(uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_client_row(_client_id uuid, _brand_id uuid, _owner_user_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role text;
BEGIN
  IF _user_id IS NULL OR _brand_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin(_user_id) THEN
    RETURN true;
  END IF;

  -- Escopo INTERNO apenas. Usuários do Portal (client_members.role =
  -- 'portal_client') NÃO entram por aqui (ver is_portal_client_of).
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_members
     WHERE brand_id = _brand_id AND user_id = _user_id AND is_active
  ) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_user_id, _brand_id);

  -- ADMIN do workspace: todos os clientes daquele workspace.
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- MANAGER e USER: somente clientes explicitamente atribuídos.
  IF v_role IN ('manager', 'user') THEN
    IF _owner_user_id IS NOT NULL AND _owner_user_id = _user_id THEN
      RETURN true;
    END IF;
    RETURN public.is_client_assigned(_user_id, _client_id);
  END IF;

  RETURN false;
END;
$$;

--
-- Name: can_access_project(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_project(_project_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = _project_id
       AND public.is_brand_member(p.brand_id, _user_id)
       AND CASE WHEN p.client_id IS NULL
             THEN public.app_access_role(_user_id, p.brand_id) IN ('super_admin', 'admin')
             ELSE public.can_access_client(p.client_id, _user_id)
           END
  );
$$;

--
-- Name: can_access_task(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_task(_task_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = _task_id
       AND public.is_brand_member(t.brand_id, _user_id)
       AND CASE WHEN t.client_id IS NULL
             THEN public.app_access_role(_user_id, t.brand_id) IN ('super_admin', 'admin')
             ELSE public.can_access_client(t.client_id, _user_id)
           END
       AND (t.project_id IS NULL OR public.can_access_project(t.project_id, _user_id))
  );
$$;

--
-- Name: can_create_brand(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_brand(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _user_id IS NOT NULL
    AND (
      public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.brand_members bm
         WHERE bm.user_id = _user_id
           AND bm.is_active
           AND bm.role IN ('owner', 'admin', 'manager', 'user')
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.client_members cm
         WHERE cm.user_id = _user_id
           AND cm.role = 'portal_client'
      )
    );
$$;

--
-- Name: can_delete_brand(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_brand(_brand_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_super_admin(_user_id)
      OR public.brand_member_role(_user_id, _brand_id) = 'owner';
$$;

--
-- Name: can_invite_brand_role(uuid, uuid, public.app_role, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_invite_brand_role(_brand_id uuid, _actor_id uuid, _role public.app_role, _email text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role text;
  v_actor_email text;
BEGIN
  IF _actor_id IS NULL OR _brand_id IS NULL OR _role IS NULL THEN
    RETURN false;
  END IF;

  IF _role NOT IN ('owner', 'admin', 'manager', 'user') THEN
    RETURN false;
  END IF;

  -- Somente SUPER ADMIN concede OWNER.
  IF public.is_super_admin(_actor_id) THEN
    RETURN true;
  END IF;

  SELECT lower(u.email) INTO v_actor_email FROM auth.users u WHERE u.id = _actor_id;
  IF v_actor_email IS NOT NULL AND v_actor_email = lower(coalesce(_email, '')) THEN
    RETURN false;
  END IF;

  v_role := public.app_access_role(_actor_id, _brand_id);

  -- OWNER e ADMIN: concedem admin/manager/user, nunca owner.
  IF v_role = 'admin' THEN
    RETURN _role IN ('admin', 'manager', 'user');
  END IF;

  IF v_role = 'manager' THEN
    RETURN _role = 'user';
  END IF;

  RETURN false;
END;
$$;

--
-- Name: can_manage_brand_ai_limits(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members m
       WHERE m.brand_id = _brand_id AND m.user_id = _user_id AND m.is_active
         AND m.role IN ('owner','admin','manager')
    );
$$;

--
-- Name: canonical_content_format(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_content_format(_raw text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN _raw IS NULL OR btrim(_raw) = '' THEN NULL
    WHEN lower(btrim(_raw)) LIKE 'reel%' OR lower(btrim(_raw)) LIKE '%curto%' OR lower(btrim(_raw)) IN ('video','vídeo','shorts','short','tiktok','live') THEN 'reels'
    WHEN lower(btrim(_raw)) LIKE 'stor%' THEN 'stories'
    WHEN lower(btrim(_raw)) LIKE 'carr%' OR lower(btrim(_raw)) LIKE 'carou%' THEN 'carrossel'
    WHEN lower(btrim(_raw)) LIKE 'feed%' OR lower(btrim(_raw)) LIKE 'post%' OR lower(btrim(_raw)) LIKE '%est_tico%' OR lower(btrim(_raw)) IN ('imagem','artigo','blog') THEN 'feed'
    ELSE 'feed'
  END
$$;

--
-- Name: card_approval_public_decide(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.card_approval_public_decide(_token text, _verb text, _comment text DEFAULT NULL::text, _ip text DEFAULT NULL::text, _ua text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  t record;
  p record;
BEGIN
  IF _verb IS NULL OR _verb NOT IN ('approved', 'changes_requested') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_verb', 'status', 400);
  END IF;
  IF _token IS NULL OR length(_token) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token', 'status', 404);
  END IF;

  SELECT * INTO t
    FROM public.card_approval_tokens
   WHERE token = _token
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token', 'status', 404);
  END IF;
  IF t.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_used_or_revoked', 'status', 410);
  END IF;
  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_expired', 'status', 410);
  END IF;

  SELECT id, brand_id, client_id, review_status, deleted_at
    INTO p
    FROM public.posts
   WHERE id = t.post_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'post_not_found', 'status', 404);
  END IF;
  IF p.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'post_deleted', 'status', 410);
  END IF;
  IF p.brand_id IS DISTINCT FROM t.brand_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'scope_mismatch', 'status', 403);
  END IF;
  IF p.review_status IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', 409);
  END IF;

  INSERT INTO public.card_approval_events (post_id, token_id, brand_id, verb, comment, ip, user_agent)
  VALUES (
    p.id, t.id, t.brand_id, _verb,
    NULLIF(left(COALESCE(_comment, ''), 2000), ''),
    CASE WHEN _ip IS NULL OR _ip = '' THEN NULL ELSE _ip::inet END,
    NULLIF(left(COALESCE(_ua, ''), 500), '')
  );

  IF _verb = 'approved' THEN
    UPDATE public.posts
       SET review_status = 'approved', approved_at = now()
     WHERE id = p.id;
  ELSE
    UPDATE public.posts
       SET review_status = 'rework',
           rework_notes = NULLIF(left(COALESCE(_comment, ''), 2000), '')
     WHERE id = p.id;
  END IF;

  -- Single-decision: o link deixa de ser reutilizável após uma decisão válida.
  UPDATE public.card_approval_tokens
     SET revoked_at = now()
   WHERE id = t.id;

  RETURN jsonb_build_object('ok', true, 'verb', _verb);
END $$;

--
-- Name: check_ai_usage_budget(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_ai_usage_budget(_brand_id uuid, _client_id uuid, _user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  period_start timestamptz := date_trunc('month', now());
  brand_lim   record;
  client_lim  record;
  user_lim    record;
  brand_spent numeric := 0;
  client_spent numeric := 0;
  user_spent  numeric := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_super_admin(auth.uid())
     AND NOT public.is_brand_member(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO brand_lim FROM public.ai_usage_limits
   WHERE brand_id = _brand_id AND scope = 'brand' LIMIT 1;
  IF _client_id IS NOT NULL THEN
    SELECT * INTO client_lim FROM public.ai_usage_limits
     WHERE brand_id = _brand_id AND scope = 'client' AND client_id = _client_id LIMIT 1;
  END IF;
  IF _user_id IS NOT NULL THEN
    SELECT * INTO user_lim FROM public.ai_usage_limits
     WHERE brand_id = _brand_id AND scope = 'user' AND user_id = _user_id
       AND (client_id IS NULL OR client_id = _client_id)
     ORDER BY (client_id IS NOT NULL) DESC LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(cost_usd),0) INTO brand_spent FROM public.brand_ai_usage
    WHERE brand_id = _brand_id AND created_at >= period_start;
  IF _client_id IS NOT NULL THEN
    SELECT COALESCE(SUM(cost_usd),0) INTO client_spent FROM public.brand_ai_usage
      WHERE brand_id = _brand_id AND client_id = _client_id AND created_at >= period_start;
  END IF;
  IF _user_id IS NOT NULL THEN
    SELECT COALESCE(SUM(cost_usd),0) INTO user_spent FROM public.brand_ai_usage
      WHERE brand_id = _brand_id AND actor_id = _user_id AND created_at >= period_start;
  END IF;

  IF user_lim.id IS NOT NULL AND user_lim.hard_stop AND user_spent >= user_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','user',
      'spent_usd', user_spent, 'limit_usd', user_lim.limit_usd);
  END IF;
  IF client_lim.id IS NOT NULL AND client_lim.hard_stop AND client_spent >= client_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','client',
      'spent_usd', client_spent, 'limit_usd', client_lim.limit_usd);
  END IF;
  IF brand_lim.id IS NOT NULL AND brand_lim.hard_stop AND brand_spent >= brand_lim.limit_usd THEN
    RETURN jsonb_build_object('allowed', false, 'blocked_by','brand',
      'spent_usd', brand_spent, 'limit_usd', brand_lim.limit_usd);
  END IF;

  RETURN jsonb_build_object('allowed', true,
    'brand', jsonb_build_object('spent', brand_spent, 'limit', brand_lim.limit_usd),
    'client', jsonb_build_object('spent', client_spent, 'limit', client_lim.limit_usd),
    'user', jsonb_build_object('spent', user_spent, 'limit', user_lim.limit_usd));
END; $$;

--
-- Name: claim_scheduled_social_posts(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_scheduled_social_posts(p_limit integer DEFAULT 20) RETURNS TABLE(id uuid, brand_id uuid, client_id uuid, connection_id uuid, provider text, placement text, caption text, hashtags text[], mentions text[], media jsonb, publish_attempts integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT sp.id
    FROM public.social_posts sp
    JOIN public.social_connections sc ON sc.id = sp.connection_id
    WHERE sp.status = 'scheduled'
      AND sp.scheduled_at IS NOT NULL
      AND sp.scheduled_at <= now()
      AND (sp.publish_locked_at IS NULL OR sp.publish_locked_at < now() - interval '10 minutes')
      AND sp.publish_attempts < 5
      -- Isolamento de marca
      AND sc.brand_id = sp.brand_id
      -- Isolamento de cliente: vínculo em client_social_accounts (fonte de verdade).
      AND (
        sp.client_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.client_social_accounts csa
          WHERE csa.connection_id = sp.connection_id
            AND csa.client_id = sp.client_id
            AND csa.brand_id = sp.brand_id
        )
      )
    ORDER BY sp.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF sp SKIP LOCKED
  ),
  locked AS (
    UPDATE public.social_posts sp
       SET publish_locked_at = now(),
           status = 'publishing',
           updated_at = now()
      FROM candidates c
     WHERE sp.id = c.id
     RETURNING sp.id, sp.brand_id, sp.client_id, sp.connection_id, sp.provider,
               sp.placement, sp.caption, sp.hashtags, sp.mentions, sp.media,
               sp.publish_attempts
  )
  SELECT * FROM locked;
END;
$$;

--
-- Name: client_in_scope(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_in_scope(_client_id uuid, _brand_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _brand_id IS NOT NULL
     AND public.is_brand_member(_brand_id, auth.uid())
     AND (_client_id IS NULL OR public.can_access_client(_client_id, auth.uid()));
$$;

--
-- Name: clients_set_default_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clients_set_default_owner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.owner_user_id is null then
    new.owner_user_id := coalesce(
      auth.uid(),
      (select bm.user_id from public.brand_members bm
        where bm.brand_id = new.brand_id and bm.role = 'owner' and coalesce(bm.is_active, true)
        order by bm.created_at asc limit 1)
    );
  end if;
  return new;
end;
$$;

--
-- Name: consolidate_brain_memory(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consolidate_brain_memory(_brand_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  written integer := 0;
  r record;
BEGIN
  -- 1) Tempo médio de aprovação por cliente (memória de CLIENTE).
  FOR r IN
    SELECT p.brand_id, p.client_id,
           AVG(EXTRACT(EPOCH FROM (p.approved_at - p.created_at))/3600.0) AS avg_hours,
           COUNT(*) AS n
      FROM public.posts p
     WHERE p.approved_at IS NOT NULL
       AND p.client_id IS NOT NULL
       AND p.approved_at > p.created_at            -- <== descarta inconsistências
       AND (_brand_id IS NULL OR p.brand_id = _brand_id)
     GROUP BY p.brand_id, p.client_id
    HAVING COUNT(*) >= 3
  LOOP
    INSERT INTO public.brain_memory
      (brand_id, client_id, subject_type, subject_id, memory_type, scope, key, content, confidence,
       entity_type, entity_id, category, title, description, tags, metadata, status, origin)
    VALUES
      (r.brand_id, r.client_id, 'client', r.client_id, 'pattern', 'client',
       'client:' || r.client_id || ':approval_latency',
       jsonb_build_object('avg_hours', round(r.avg_hours::numeric, 2), 'sample_size', r.n),
       LEAST(0.5 + (r.n::numeric / 50.0), 0.98),
       'client', r.client_id, 'padrao_de_aprovacao',
       'Tempo médio de aprovação',
       'Aprovações levam em média ' || round(r.avg_hours::numeric, 1) || 'h (amostra: ' || r.n || ' posts).',
       ARRAY['approval','latency','client'],
       jsonb_build_object('avg_hours', round(r.avg_hours::numeric, 2), 'sample_size', r.n),
       'active', 'consolidation')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      client_id  = EXCLUDED.client_id,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      description= EXCLUDED.description,
      status     = 'active',
      updated_at = now();
    written := written + 1;
  END LOOP;

  -- 2) Slot recorrente de publicação (memória de MARCA).
  FOR r IN
    SELECT p.brand_id,
           EXTRACT(DOW  FROM p.published_at)::int AS dow,
           EXTRACT(HOUR FROM p.published_at)::int AS hour,
           COUNT(*) AS n
      FROM public.posts p
     WHERE p.published_at IS NOT NULL
       AND (_brand_id IS NULL OR p.brand_id = _brand_id)
     GROUP BY p.brand_id, dow, hour
    HAVING COUNT(*) >= 5
  LOOP
    INSERT INTO public.brain_memory
      (brand_id, subject_type, subject_id, memory_type, scope, key, content, confidence,
       entity_type, entity_id, category, title, description, tags, metadata, status, origin)
    VALUES
      (r.brand_id, 'brand', r.brand_id, 'pattern', 'brand',
       'brand:' || r.brand_id || ':publish_slot_' || r.dow || '_' || r.hour,
       jsonb_build_object('dow', r.dow, 'hour', r.hour, 'sample_size', r.n),
       LEAST(0.4 + (r.n::numeric / 40.0), 0.95),
       'brand', r.brand_id, 'publish_slot',
       'Slot recorrente: dia ' || r.dow || ' às ' || r.hour || 'h',
       'Padrão de publicação identificado (amostra: ' || r.n || ').',
       ARRAY['publish','schedule','pattern'],
       jsonb_build_object('dow', r.dow, 'hour', r.hour, 'sample_size', r.n),
       'active', 'consolidation')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      status     = 'active',
      updated_at = now();
    written := written + 1;
  END LOOP;

  -- 3) Risco de atraso por projeto (memória de MARCA).
  FOR r IN
    SELECT pr.brand_id, pr.id AS project_id, pr.name,
           COUNT(t.id)                                                    AS tasks,
           COUNT(t.id) FILTER (WHERE t.due_at < now() AND t.done = false)  AS overdue
      FROM public.projects pr
      LEFT JOIN public.tasks t ON t.project_id = pr.id
     WHERE (_brand_id IS NULL OR pr.brand_id = _brand_id)
     GROUP BY pr.brand_id, pr.id, pr.name
    HAVING COUNT(t.id) >= 10 AND COUNT(t.id) FILTER (WHERE t.due_at < now() AND t.done = false) > 0
  LOOP
    INSERT INTO public.brain_memory
      (brand_id, subject_type, subject_id, memory_type, scope, key, content, confidence,
       entity_type, entity_id, category, title, description, tags, metadata, status, origin)
    VALUES
      (r.brand_id, 'project', r.project_id, 'pattern', 'brand',
       'project:' || r.project_id || ':delay_risk',
       jsonb_build_object('tasks', r.tasks, 'overdue', r.overdue),
       LEAST(0.5 + (r.overdue::numeric / GREATEST(r.tasks,1))*0.5, 0.98),
       'project', r.project_id, 'delay_risk',
       'Risco de atraso: ' || coalesce(r.name, 'projeto'),
       r.overdue || ' de ' || r.tasks || ' tarefas em atraso.',
       ARRAY['delay','risk','project'],
       jsonb_build_object('tasks', r.tasks, 'overdue', r.overdue),
       'active', 'consolidation')
    ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title)
    DO UPDATE SET
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      confidence = EXCLUDED.confidence,
      description= EXCLUDED.description,
      status     = 'active',
      updated_at = now();
    written := written + 1;
  END LOOP;

  RETURN written;
END;
$$;

--
-- Name: cron_secret(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cron_secret() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
$$;

--
-- Name: derive_post_stage(uuid, public.post_stage); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.derive_post_stage(_stage_id uuid, _current public.post_stage) RETURNS public.post_stage
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _key text;
  _terminal boolean;
BEGIN
  IF _stage_id IS NULL THEN
    RETURN _current;
  END IF;

  SELECT lower(s.key), COALESCE(s.is_terminal, false)
    INTO _key, _terminal
  FROM public.content_pipeline_stages s
  WHERE s.id = _stage_id;

  -- Stage inexistente: preserva o valor legado atual
  IF _key IS NULL THEN
    RETURN _current;
  END IF;

  -- Mapeamento canônico key -> enum post_stage
  IF _key IN ('idea', 'production', 'review', 'approved', 'scheduled', 'published') THEN
    RETURN _key::public.post_stage;
  END IF;

  -- Fallback documentado para stages customizados sem correspondência no enum:
  -- 1) coluna terminal -> 'scheduled' (mantém o comportamento legado do movePostFn);
  -- 2) qualquer outra coluna customizada -> preserva o valor legado atual
  --    (nunca inventamos um valor de enum).
  IF _terminal THEN
    RETURN 'scheduled'::public.post_stage;
  END IF;

  RETURN _current;
END;
$$;

--
-- Name: derive_relationships_from_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.derive_relationships_from_event(_event_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  e record;
  v_count integer := 0;
  v_project_client uuid;
BEGIN
  SELECT * INTO e FROM public.brain_events WHERE id = _event_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- actor -> entity  (worked_on)
  IF e.actor_id IS NOT NULL AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, 'user', e.actor_id, e.entity_type, e.entity_id,
      'worked_on', 0.05, jsonb_build_object('last_action', e.action), false);
    v_count := v_count + 1;
  END IF;

  -- client -> entity  (owns)
  IF e.client_id IS NOT NULL AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL
     AND NOT (e.entity_type = 'client' AND e.entity_id = e.client_id) THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, 'client', e.client_id, e.entity_type, e.entity_id,
      'owns', 0.1, '{}'::jsonb, false);
    v_count := v_count + 1;
  END IF;

  -- project -> entity  (contains)
  IF e.project_id IS NOT NULL AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL
     AND NOT (e.entity_type = 'project' AND e.entity_id = e.project_id) THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, 'project', e.project_id, e.entity_type, e.entity_id,
      'contains', 0.1, '{}'::jsonb, false);
    v_count := v_count + 1;
  END IF;

  -- client -> project (owns)
  IF e.client_id IS NOT NULL AND e.project_id IS NOT NULL THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, 'client', e.client_id, 'project', e.project_id,
      'owns', 0.1, '{}'::jsonb, false);
    v_count := v_count + 1;
  END IF;

  -- project derived from projects table (post/task without project_id but with client_id -> attach to same client)
  IF e.entity_type = 'project' AND e.entity_id IS NOT NULL THEN
    SELECT client_id INTO v_project_client FROM public.projects WHERE id = e.entity_id;
    IF v_project_client IS NOT NULL THEN
      PERFORM public.upsert_brain_relationship(
        e.brand_id, 'client', v_project_client, 'project', e.entity_id,
        'owns', 0.1, '{}'::jsonb, false);
      v_count := v_count + 1;
    END IF;
  END IF;

  -- signal edges: outcome relationships from action
  IF e.action IN ('approved','published','completed','delivered')
     AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL
     AND e.client_id IS NOT NULL THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, e.entity_type, e.entity_id, 'client', e.client_id,
      'positive_outcome', 0.08, jsonb_build_object('action', e.action), false);
    v_count := v_count + 1;
  END IF;

  IF e.action IN ('rejected','failed','overdue','cancelled')
     AND e.entity_type IS NOT NULL AND e.entity_id IS NOT NULL
     AND e.client_id IS NOT NULL THEN
    PERFORM public.upsert_brain_relationship(
      e.brand_id, e.entity_type, e.entity_id, 'client', e.client_id,
      'negative_outcome', 0.08, jsonb_build_object('action', e.action), false);
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END $$;

--
-- Name: emit_brain_event(uuid, text, text, uuid, text, uuid, text, uuid, uuid, jsonb, numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.emit_brain_event(p_brand_id uuid, p_event_type text, p_source_module text, p_actor_id uuid DEFAULT NULL::uuid, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_confidence numeric DEFAULT 1.0, p_correlation_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.brain_events (
    brand_id, event_type, source_module, actor_id,
    entity_type, entity_id, action, client_id, project_id,
    payload, confidence, correlation_id
  ) VALUES (
    p_brand_id, p_event_type, p_source_module, p_actor_id,
    p_entity_type, p_entity_id, p_action, p_client_id, p_project_id,
    COALESCE(p_payload, '{}'::jsonb), COALESCE(p_confidence, 1.0), p_correlation_id
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

--
-- Name: enable_default_brand_features(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enable_default_brand_features() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.brand_features (brand_id, feature_key, enabled, enabled_at)
  SELECT NEW.id, fc.key, true, now()
  FROM public.feature_catalog fc
  WHERE fc.default_enabled = true
  ON CONFLICT (brand_id, feature_key) DO NOTHING;
  RETURN NEW;
END;
$$;

--
-- Name: enforce_task_project_client(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_task_project_client() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  proj_brand uuid;
  proj_client uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT brand_id, client_id INTO proj_brand, proj_client
  FROM public.projects WHERE id = NEW.project_id;

  IF proj_brand IS NULL THEN
    RAISE EXCEPTION 'Projeto inexistente';
  END IF;

  IF proj_brand <> NEW.brand_id THEN
    RAISE EXCEPTION 'O projeto pertence a outra workspace';
  END IF;

  IF proj_client IS NOT NULL AND NEW.client_id IS DISTINCT FROM proj_client THEN
    RAISE EXCEPTION 'O projeto pertence a outro cliente';
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: enqueue_brain_event_for_learning(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_brain_event_for_learning() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.brain_learning_queue (event_id, brand_id) VALUES (NEW.id, NEW.brand_id);
  RETURN NEW;
END $$;

--
-- Name: enqueue_deadline_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_deadline_notifications() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  inserted integer := 0;
  added integer := 0;
BEGIN
  WITH candidates AS (
    SELECT t.id AS entity_id, t.brand_id, t.assignee_id AS user_id, t.title, t.due_at
      FROM public.tasks t
     WHERE t.assignee_id IS NOT NULL
       AND t.done = false
       AND t.due_at IS NOT NULL
       AND t.due_at > now()
       AND t.due_at <= now() + interval '24 hours'
       AND public.notification_prefs_allows(t.assignee_id, 'deadline')
  ),
  filtered AS (
    SELECT c.* FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = c.user_id
          AND n.kind = 'deadline'
          AND n.dedupe_key = 'deadline:task:' || c.entity_id::text
          AND (n.read_at IS NULL OR n.created_at > now() - interval '20 hours')
     )
  ),
  ins AS (
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload, dedupe_key)
    SELECT user_id, brand_id, 'deadline',
           'Tarefa vence em breve',
           title,
           '/tasks?task=' || entity_id::text,
           jsonb_build_object('source','task','entity_id', entity_id, 'due_at', due_at),
           'deadline:task:' || entity_id::text
      FROM filtered
    ON CONFLICT (user_id, kind, dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(count(*),0) INTO inserted FROM ins;

  WITH candidates AS (
    SELECT p.id AS entity_id, p.brand_id, p.client_id, p.assignee_id AS user_id, p.title, p.scheduled_at
      FROM public.posts p
     WHERE p.assignee_id IS NOT NULL
       AND p.scheduled_at IS NOT NULL
       AND p.scheduled_at > now()
       AND p.scheduled_at <= now() + interval '24 hours'
       AND p.stage <> 'published'::public.post_stage
       AND p.deleted_at IS NULL
       AND public.notification_prefs_allows(p.assignee_id, 'deadline')
  ),
  filtered AS (
    SELECT c.* FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = c.user_id
          AND n.kind = 'deadline'
          AND n.dedupe_key = 'deadline:post:' || c.entity_id::text
          AND (n.read_at IS NULL OR n.created_at > now() - interval '20 hours')
     )
  ),
  ins AS (
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload, dedupe_key)
    SELECT user_id, brand_id, 'deadline',
           'Publicação agendada em breve',
           title,
           '/customers/' || COALESCE(client_id::text,'') || '?post=' || entity_id::text,
           jsonb_build_object('source','post','entity_id', entity_id, 'scheduled_at', scheduled_at),
           'deadline:post:' || entity_id::text
      FROM filtered
    ON CONFLICT (user_id, kind, dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(count(*),0) INTO added FROM ins;

  RETURN inserted + added;
END $$;

--
-- Name: find_user_id_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_user_id_by_email(_email text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  SELECT u.id
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(_email))
  LIMIT 1
$$;

--
-- Name: get_brain_graph(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_brain_graph(_brand_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 300) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_edges jsonb;
  v_nodes jsonb;
BEGIN
  IF _brand_id IS NOT NULL
     AND NOT public.is_super_admin(auth.uid())
     AND NOT public.is_brand_member(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH edges AS (
    SELECT r.*
      FROM public.brain_relationships r
     WHERE (_brand_id IS NULL OR r.brand_id = _brand_id)
       AND (public.is_super_admin(auth.uid())
            OR public.client_in_scope(r.client_id, r.brand_id))
     ORDER BY r.strength DESC, r.last_observed_at DESC NULLS LAST
     LIMIT GREATEST(10, LEAST(_limit, 2000))
  ),
  node_ids AS (
    SELECT from_type AS t, from_id AS i FROM edges
    UNION
    SELECT to_type,   to_id   FROM edges
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'from', jsonb_build_object('type', e.from_type, 'id', e.from_id),
      'to',   jsonb_build_object('type', e.to_type,   'id', e.to_id),
      'type', e.relationship_type,
      'strength', e.strength,
      'confidence', e.confidence,
      'observations', e.observation_count,
      'last_observed_at', e.last_observed_at
    )), '[]'::jsonb),
    (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('type', t, 'id', i)), '[]'::jsonb) FROM node_ids)
  INTO v_edges, v_nodes
  FROM edges e;

  RETURN jsonb_build_object('nodes', v_nodes, 'edges', v_edges);
END $$;

--
-- Name: get_brain_neighborhood(uuid, text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_brain_neighborhood(_brand_id uuid, _entity_type text, _entity_id uuid, _depth integer DEFAULT 2) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_edges jsonb;
  v_nodes jsonb;
  v_super boolean := public.is_super_admin(auth.uid());
BEGIN
  IF _brand_id IS NOT NULL
     AND NOT v_super
     AND NOT public.is_brand_member(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH RECURSIVE walk AS (
    SELECT _entity_type AS t, _entity_id AS i, 0 AS d
    UNION
    SELECT r.to_type, r.to_id, w.d + 1
      FROM walk w
      JOIN public.brain_relationships r
        ON (r.brand_id IS NOT DISTINCT FROM _brand_id)
       AND (v_super OR public.client_in_scope(r.client_id, r.brand_id))
       AND ((r.from_type = w.t AND r.from_id = w.i)
         OR (r.to_type   = w.t AND r.to_id   = w.i))
     WHERE w.d < GREATEST(1, LEAST(_depth, 4))
  ),
  reachable AS (
    SELECT DISTINCT t, i FROM walk
  ),
  edges AS (
    SELECT r.*
      FROM public.brain_relationships r
     WHERE (r.brand_id IS NOT DISTINCT FROM _brand_id)
       AND (v_super OR public.client_in_scope(r.client_id, r.brand_id))
       AND EXISTS (SELECT 1 FROM reachable rf WHERE rf.t = r.from_type AND rf.i = r.from_id)
       AND EXISTS (SELECT 1 FROM reachable rt WHERE rt.t = r.to_type   AND rt.i = r.to_id)
     LIMIT 500
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'from', jsonb_build_object('type', e.from_type, 'id', e.from_id),
      'to',   jsonb_build_object('type', e.to_type,   'id', e.to_id),
      'type', e.relationship_type,
      'strength', e.strength,
      'confidence', e.confidence,
      'observations', e.observation_count
    )), '[]'::jsonb),
    (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('type', t, 'id', i)), '[]'::jsonb) FROM reachable)
  INTO v_edges, v_nodes
  FROM edges e;

  RETURN jsonb_build_object('nodes', v_nodes, 'edges', v_edges);
END $$;

--
-- Name: guard_super_admin_flag(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_super_admin_flag() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_privileged boolean := v_actor IS NULL OR public.is_super_admin(v_actor);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (COALESCE(NEW.is_super_admin, false) = true
        OR COALESCE(NEW.role, 'user') = 'super_admin')
       AND NOT v_privileged THEN
      RAISE EXCEPTION 'Forbidden: apenas super admin cria perfil privilegiado'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_super_admin, false) IS DISTINCT FROM COALESCE(OLD.is_super_admin, false)
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'Forbidden: apenas super admin altera is_super_admin'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NEW.role, '') IS DISTINCT FROM COALESCE(OLD.role, '')
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'Forbidden: apenas super admin altera role do perfil'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role text;
  v_full_name text;
BEGIN
  v_role := lower(coalesce(NEW.raw_user_meta_data->>'role', ''));
  IF v_role NOT IN ('admin', 'manager', 'user', 'super_admin') THEN
    v_role := 'user';
  END IF;

  v_full_name := coalesce(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(NEW.email, ''), '@', 1),
    'Usuário'
  );

  BEGIN
    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES (NEW.id, v_full_name, v_role)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: falha ao criar perfil para %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

--
-- Name: has_brand_role(uuid, uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_brand_role(_brand_id uuid, _user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members
       WHERE brand_id = _brand_id AND user_id = _user_id AND role = _role AND is_active
    );
$$;

--
-- Name: instantiate_project_template(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.instantiate_project_template(_template_id uuid, _brand_id uuid, _client_id uuid, _project_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _uid UUID := auth.uid(); _new_project UUID; _tpl_visible BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  IF NOT public.is_brand_member(_brand_id, _uid) AND NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _client_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.brand_id = _brand_id
    ) THEN
      RAISE EXCEPTION 'client_out_of_workspace';
    END IF;
    IF NOT public.can_access_client(_client_id, _uid) THEN
      RAISE EXCEPTION 'client_out_of_scope';
    END IF;
  END IF;

  SELECT (is_system OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, _uid)))
    INTO _tpl_visible FROM public.project_templates WHERE id = _template_id;
  IF NOT COALESCE(_tpl_visible, false) THEN RAISE EXCEPTION 'Template not visible'; END IF;

  INSERT INTO public.projects (brand_id, client_id, name, status, owner_id)
    VALUES (_brand_id, _client_id, _project_name, 'active', _uid)
    RETURNING id INTO _new_project;

  WITH job_map AS (
    INSERT INTO public.project_jobs (project_id, brand_id, name, description, color, position)
      SELECT _new_project, _brand_id, tj.name, tj.description, tj.color, tj.position
      FROM public.project_template_jobs tj
      WHERE tj.template_id = _template_id
      RETURNING id, name, position
  ),
  paired AS (
    SELECT jm.id AS new_job_id, tj.id AS tpl_job_id
    FROM public.project_template_jobs tj
    JOIN job_map jm ON jm.name = tj.name AND jm.position = tj.position
    WHERE tj.template_id = _template_id
  )
  INSERT INTO public.tasks (brand_id, client_id, project_id, job_id, title, description, priority, estimated_minutes, position, status, created_by)
    SELECT _brand_id, _client_id, _new_project, p.new_job_id, tt.title, tt.description,
           COALESCE(tt.priority, 'medium')::task_priority,
           tt.estimated_minutes, tt.position, 'todo'::task_status, _uid
    FROM paired p
    JOIN public.project_template_tasks tt ON tt.template_job_id = p.tpl_job_id;

  RETURN _new_project;
END; $$;

--
-- Name: is_agency_operator(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_agency_operator(_user_id uuid, _brand_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.app_access_role(_user_id, _brand_id) IN ('super_admin', 'admin', 'manager', 'user');
$$;

--
-- Name: is_brand_admin_level(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_brand_admin_level(_brand_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.app_access_role(_user_id, _brand_id) IN ('super_admin', 'admin', 'manager');
$$;

--
-- Name: is_brand_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_brand_member(_brand_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members
       WHERE brand_id = _brand_id AND user_id = _user_id AND is_active
    );
$$;

--
-- Name: is_client_assigned(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_client_assigned(_user_id uuid, _client_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _user_id IS NOT NULL AND _client_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = _client_id AND c.owner_user_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.client_members cm
       WHERE cm.client_id = _client_id
         AND cm.user_id = _user_id
         AND cm.role <> 'portal_client'
    )
  );
$$;

--
-- Name: is_global_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_global_admin(_user_id uuid) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT false;
$$;

--
-- Name: is_portal_client_of(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_portal_client_of(_client_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _client_id IS NOT NULL AND _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.client_members cm
     WHERE cm.client_id = _client_id
       AND cm.user_id = _user_id
       AND cm.role = 'portal_client'
  );
$$;

--
-- Name: is_portal_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_portal_user(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.client_members
    WHERE user_id = _user_id AND role = 'portal_client'
  );
$$;

--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_super_admin(auth.uid());
$$;

--
-- Name: is_super_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT is_super_admin OR role = 'super_admin'
     FROM public.user_profiles
     WHERE id = _user_id),
    false
  );
$$;

--
-- Name: link_existing_user_to_brand(uuid, text, public.app_role, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_existing_user_to_brand(_brand_id uuid, _email text, _role public.app_role, _permissions jsonb DEFAULT '[]'::jsonb) RETURNS TABLE(status text, email text, user_id uuid, full_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := auth.uid();
  v_target uuid;
  v_existing record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brand_members bm
    WHERE bm.brand_id = _brand_id
      AND bm.user_id = v_actor
      AND bm.is_active
      AND bm.role IN ('owner', 'admin', 'manager')
  ) AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT public.can_invite_brand_role(_brand_id, v_actor, _role, _email) THEN
    RAISE EXCEPTION 'role_authority_invalid';
  END IF;

  SELECT public.find_user_id_by_email(_email) INTO v_target;

  IF v_target IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, lower(trim(_email))::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_target = v_actor AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'self_promotion_blocked';
  END IF;

  SELECT bm.role::text AS role, bm.permissions
  INTO v_existing
  FROM public.brand_members bm
  WHERE bm.brand_id = _brand_id
    AND bm.user_id = v_target;

  -- Owner existente só pode ser rebaixado/alterado por super admin.
  IF v_existing.role = 'owner' AND NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'owner_change_requires_super_admin';
  END IF;

  INSERT INTO public.brand_members (brand_id, user_id, role, permissions)
  VALUES (_brand_id, v_target, _role, COALESCE(_permissions, '[]'::jsonb))
  ON CONFLICT (brand_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    permissions = EXCLUDED.permissions;

  RETURN QUERY
  SELECT
    CASE
      WHEN v_existing IS NULL THEN 'added'::text
      WHEN v_existing.role = _role::text AND COALESCE(v_existing.permissions, '[]'::jsonb) = COALESCE(_permissions, '[]'::jsonb) THEN 'already_member'::text
      ELSE 'updated'::text
    END,
    lower(trim(_email))::text,
    v_target,
    up.full_name
  FROM public.user_profiles up
  WHERE up.id = v_target;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      CASE
        WHEN v_existing IS NULL THEN 'added'::text
        WHEN v_existing.role = _role::text AND COALESCE(v_existing.permissions, '[]'::jsonb) = COALESCE(_permissions, '[]'::jsonb) THEN 'already_member'::text
        ELSE 'updated'::text
      END,
      lower(trim(_email))::text,
      v_target,
      NULL::text;
  END IF;
END;
$$;

--
-- Name: list_agent_catalog(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_agent_catalog() RETURNS TABLE(agent_id text, agent_name text, required_fields jsonb, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT agent_id, agent_name, required_fields, updated_at
  FROM public.agent_prompts
  ORDER BY agent_name;
$$;

--
-- Name: list_ai_usage_overview(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_ai_usage_overview(_brand_id uuid, _period_start timestamp with time zone DEFAULT date_trunc('month'::text, now()), _period_end timestamp with time zone DEFAULT (date_trunc('month'::text, now()) + '1 mon'::interval)) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  result jsonb;
  brand_spent numeric := 0;
  brand_limit numeric;
  brand_hard boolean;
  brand_notify int;
  v_full boolean;
BEGIN
  IF NOT public.can_manage_brand_ai_limits(_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Autoridade total no workspace (super admin / admin) vê a agregação completa.
  v_full := public.is_super_admin(auth.uid())
            OR public.app_access_role(auth.uid(), _brand_id) IN ('super_admin', 'admin');

  SELECT COALESCE(SUM(u.cost_usd), 0) INTO brand_spent
    FROM public.brand_ai_usage u
   WHERE u.brand_id = _brand_id
     AND u.created_at >= _period_start AND u.created_at < _period_end
     AND (v_full OR (u.client_id IS NOT NULL
                     AND public.can_access_client(u.client_id, auth.uid())));

  SELECT limit_usd, hard_stop, notify_at_pct
    INTO brand_limit, brand_hard, brand_notify
    FROM public.ai_usage_limits
   WHERE brand_id = _brand_id AND scope = 'brand' LIMIT 1;

  result := jsonb_build_object(
    'brand', jsonb_build_object(
      'spent', brand_spent,
      'limit', CASE WHEN v_full THEN brand_limit ELSE NULL END,
      'hard_stop', CASE WHEN v_full THEN brand_hard ELSE NULL END,
      'notify_at_pct', CASE WHEN v_full THEN brand_notify ELSE NULL END
    ),
    'scoped', NOT v_full,
    'clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', c.id,
        'client_name', c.name,
        'spent', COALESCE(u.spent, 0),
        'limit', l.limit_usd,
        'hard_stop', l.hard_stop,
        'notify_at_pct', l.notify_at_pct,
        'limit_id', l.id
      ) ORDER BY COALESCE(u.spent, 0) DESC)
      FROM public.clients c
      LEFT JOIN (
        SELECT client_id, SUM(cost_usd) AS spent
          FROM public.brand_ai_usage
         WHERE brand_id = _brand_id AND client_id IS NOT NULL
           AND created_at >= _period_start AND created_at < _period_end
         GROUP BY client_id
      ) u ON u.client_id = c.id
      LEFT JOIN public.ai_usage_limits l
        ON l.brand_id = _brand_id AND l.scope = 'client' AND l.client_id = c.id
     WHERE c.brand_id = _brand_id
       AND (v_full OR public.can_access_client(c.id, auth.uid()))
    ), '[]'::jsonb),
    -- Consumo sem cliente é agregação de workspace: só para autoridade total.
    'unassigned_client_spent', CASE WHEN v_full THEN COALESCE((
      SELECT SUM(cost_usd) FROM public.brand_ai_usage
       WHERE brand_id = _brand_id AND client_id IS NULL
         AND created_at >= _period_start AND created_at < _period_end
    ), 0) ELSE 0 END,
    'users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.actor_id,
        'client_id', u.client_id,
        'display_name', p.full_name,
        'email', au.email,
        'spent', u.spent,
        'limit', l.limit_usd,
        'hard_stop', l.hard_stop,
        'notify_at_pct', l.notify_at_pct,
        'limit_id', l.id
      ) ORDER BY u.spent DESC)
      FROM (
        SELECT actor_id, client_id, SUM(cost_usd) AS spent
          FROM public.brand_ai_usage
         WHERE brand_id = _brand_id AND actor_id IS NOT NULL
           AND created_at >= _period_start AND created_at < _period_end
         GROUP BY actor_id, client_id
      ) u
      LEFT JOIN public.user_profiles p ON p.id = u.actor_id
      LEFT JOIN auth.users au ON au.id = u.actor_id
      LEFT JOIN public.ai_usage_limits l
        ON l.brand_id = _brand_id AND l.scope = 'user' AND l.user_id = u.actor_id
       AND (l.client_id IS NULL OR l.client_id = u.client_id)
      WHERE v_full
         OR (u.client_id IS NOT NULL AND public.can_access_client(u.client_id, auth.uid()))
    ), '[]'::jsonb)
  );

  RETURN result;
END; $$;

--
-- Name: log_post_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_post_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
    VALUES (NEW.brand_id, NEW.client_id, NEW.created_by, 'post', NEW.id, 'created',
            jsonb_build_object('title', NEW.title));
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.stage_id IS DISTINCT FROM NEW.stage_id OR OLD.stage <> NEW.stage THEN
      INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
      VALUES (NEW.brand_id, NEW.client_id, auth.uid(), 'post', NEW.id, 'stage_changed',
              jsonb_build_object(
                'from', OLD.stage, 'to', NEW.stage,
                'from_stage_id', OLD.stage_id, 'to_stage_id', NEW.stage_id,
                'title', NEW.title
              ));
    END IF;
    IF OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
      INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
      VALUES (NEW.brand_id, NEW.client_id, auth.uid(), 'post', NEW.id, 'pipeline_changed',
              jsonb_build_object(
                'from_pipeline_id', OLD.pipeline_id,
                'to_pipeline_id', NEW.pipeline_id,
                'title', NEW.title
              ));
    END IF;
  END IF;
  RETURN NEW;
END $$;

--
-- Name: log_task_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_task_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
    VALUES (NEW.brand_id, NEW.client_id, NEW.created_by, 'task', NEW.id, 'created', jsonb_build_object('title', NEW.title));
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
    INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
    VALUES (NEW.brand_id, NEW.client_id, auth.uid(), 'task', NEW.id, 'status_changed',
            jsonb_build_object('from', OLD.status, 'to', NEW.status, 'title', NEW.title));
  END IF;
  RETURN NEW;
END $$;

--
-- Name: mark_social_post_blocked(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_social_post_blocked(p_post_id uuid, p_error text, p_reason text DEFAULT 'connection_required'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_post_id uuid;
  v_conn uuid;
  v_placement text;
BEGIN
  UPDATE public.social_posts
     SET status = 'blocked',
         last_error = p_error,
         publish_locked_at = NULL,
         updated_at = now()
   WHERE id = p_post_id
  RETURNING post_id, connection_id, placement INTO v_post_id, v_conn, v_placement;

  IF v_post_id IS NULL OR v_conn IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.post_placements pp
     SET status = p_reason,
         updated_at = now()
   WHERE pp.post_id = v_post_id
     AND pp.connection_id = v_conn
     AND (
       (v_placement = 'story' AND pp.format = 'stories')
       OR (v_placement <> 'story' AND pp.format <> 'stories')
     )
     AND pp.status NOT IN ('published');
END;
$$;

--
-- Name: mark_social_post_failed(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_social_post_failed(p_post_id uuid, p_error text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_attempts int;
BEGIN
  UPDATE public.social_posts
     SET publish_attempts = publish_attempts + 1,
         last_error = p_error,
         publish_locked_at = NULL,
         status = CASE
           WHEN publish_attempts + 1 >= 5 THEN 'failed'
           ELSE 'scheduled'
         END,
         updated_at = now()
   WHERE id = p_post_id
  RETURNING publish_attempts INTO v_attempts;
END;
$$;

--
-- Name: mark_social_post_published(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_social_post_published(p_post_id uuid, p_external_id text, p_permalink text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  UPDATE public.social_posts
     SET status = 'published',
         published_at = now(),
         external_post_id = p_external_id,
         external_permalink = p_permalink,
         last_error = NULL,
         publish_locked_at = NULL,
         updated_at = now()
   WHERE id = p_post_id;
$$;

--
-- Name: match_brain_events(uuid, public.vector, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_brain_events(_brand_id uuid, _query public.vector, _match_count integer DEFAULT 8) RETURNS TABLE(event_id uuid, content_summary text, event_type text, source_module text, payload jsonb, created_at timestamp with time zone, similarity double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    e.id as event_id,
    em.content_summary,
    e.event_type,
    e.source_module,
    e.payload,
    e.created_at,
    1 - (em.embedding <=> _query) as similarity
  from public.brain_embeddings em
  join public.brain_events e on e.id = em.event_id
  where em.brand_id = _brand_id
    and em.embedding is not null
    and (
      public.is_super_admin(auth.uid())
      or public.client_in_scope(e.client_id, e.brand_id)
    )
  order by em.embedding <=> _query
  limit _match_count;
$$;

--
-- Name: media_plan_public_items(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.media_plan_public_items(_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE p record; rows jsonb;
BEGIN
  IF _token IS NULL OR length(_token) < 8 THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT id, share_expires_at INTO p FROM public.media_plans WHERE share_token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF p.share_expires_at IS NOT NULL AND p.share_expires_at < now() THEN RAISE EXCEPTION 'token_expired'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.position ASC), '[]'::jsonb) INTO rows FROM (
    SELECT id, position, product_service, campaign_type, funnel_stage, objective,
           main_kpi, channel, audience, budget_pct, budget_amount, keywords,
           benchmark, other_refs
      FROM public.media_plan_items WHERE plan_id = p.id
     ORDER BY position ASC
  ) x;
  RETURN rows;
END $$;

--
-- Name: media_plan_public_resolve(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.media_plan_public_resolve(_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE p record; c record; b record;
BEGIN
  IF _token IS NULL OR length(_token) < 8 THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT * INTO p FROM public.media_plans WHERE share_token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF p.share_expires_at IS NOT NULL AND p.share_expires_at < now() THEN RAISE EXCEPTION 'token_expired'; END IF;
  SELECT id, name INTO c FROM public.clients WHERE id = p.client_id;
  SELECT id, name INTO b FROM public.brands WHERE id = p.brand_id;
  RETURN jsonb_build_object(
    'plan', jsonb_build_object(
      'id', p.id, 'title', p.title, 'status', p.status,
      'period_start', p.period_start, 'period_end', p.period_end,
      'monthly_budget', p.monthly_budget,
      'updated_at', p.updated_at
    ),
    'client', jsonb_build_object('id', c.id, 'name', c.name),
    'brand',  jsonb_build_object('id', b.id, 'name', b.name)
  );
END $$;

--
-- Name: message_logs_guard_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.message_logs_guard_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = NEW.client_id AND c.brand_id = NEW.brand_id
    ) THEN
      RAISE EXCEPTION 'message_logs: client_id % não pertence ao brand_id %', NEW.client_id, NEW.brand_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: my_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_access(_brand_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  su AS (SELECT public.is_super_admin((SELECT uid FROM me)) AS is_su),
  role AS (SELECT public.app_access_role((SELECT uid FROM me), _brand_id) AS r)
  SELECT jsonb_build_object(
    'user_id', (SELECT uid FROM me),
    'brand_id', _brand_id,
    'role', (SELECT r FROM role),
    'is_super_admin', (SELECT is_su FROM su),
    'brand_role', CASE WHEN _brand_id IS NULL THEN NULL
      ELSE public.brand_member_role((SELECT uid FROM me), _brand_id) END,
    'client_ids', COALESCE((
      SELECT jsonb_agg(c.id ORDER BY c.id)
        FROM public.clients c
       WHERE (_brand_id IS NULL OR c.brand_id = _brand_id)
         AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, (SELECT uid FROM me))
    ), '[]'::jsonb),
    'brand_ids', COALESCE((
      CASE WHEN (SELECT is_su FROM su)
        THEN (SELECT jsonb_agg(b.id) FROM public.brands b)
        ELSE (SELECT jsonb_agg(bm.brand_id) FROM public.brand_members bm
               WHERE bm.user_id = (SELECT uid FROM me) AND bm.is_active)
      END
    ), '[]'::jsonb)
  );
$$;

--
-- Name: normalize_app_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_app_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.role IN ('editor','designer') THEN
    NEW.role := 'user'::public.app_role;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: normalize_client_member_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_client_member_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.role IN ('editor','designer') THEN
    NEW.role := 'user';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: notification_pref_for_kind(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_pref_for_kind(_kind text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE _kind
    WHEN 'mention' THEN 'comments'
    WHEN 'assignment' THEN 'assignments'
    WHEN 'approval_requested' THEN 'approvals'
    WHEN 'approval_decision' THEN 'approvals'
    WHEN 'deadline' THEN 'deadlines'
    WHEN 'system' THEN 'ai_jobs'
    ELSE NULL   -- kinds críticos: sla_overdue, sla_overdue_manager, briefing_submitted
  END
$$;

--
-- Name: notification_prefs_allows(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_prefs_allows(_user_id uuid, _kind text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN public.notification_pref_for_kind(_kind) IS NULL THEN true
    ELSE COALESCE(
      (SELECT (up.notification_prefs -> public.notification_pref_for_kind(_kind))::text
         FROM public.user_profiles up WHERE up.id = _user_id) <> 'false',
      true)
  END
$$;

--
-- Name: notify_ai_job_completed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_ai_job_completed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('completed','failed')
     AND COALESCE(OLD.status, '') <> NEW.status
     AND NEW.user_id IS NOT NULL
     AND public.notification_prefs_allows(NEW.user_id, 'system') THEN
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
    VALUES (
      NEW.user_id, NEW.brand_id, 'system',
      CASE WHEN NEW.status = 'completed'
           THEN COALESCE(NEW.title, 'Job de IA') || ' concluído'
           ELSE COALESCE(NEW.title, 'Job de IA') || ' falhou' END,
      COALESCE(NEW.subtitle, NEW.error, NULL),
      NEW.target_route,
      jsonb_build_object('source','ai_job','job_id', NEW.id, 'status', NEW.status, 'kind', NEW.kind)
    );
  END IF;
  RETURN NEW;
END $$;

--
-- Name: notify_post_approval_events(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_post_approval_events() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  target uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.stage = 'review'::public.post_stage
     AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
    SELECT m.user_id, NEW.brand_id, 'approval_requested',
           'Post aguardando aprovação',
           NEW.title,
           '/customers/' || COALESCE(NEW.client_id::text, '') || '?post=' || NEW.id::text,
           jsonb_build_object('source','post','post_id', NEW.id)
      FROM public.brand_members m
     WHERE m.brand_id = NEW.brand_id
       AND m.user_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
       AND public.notification_prefs_allows(m.user_id, 'approval_requested');
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.stage IS DISTINCT FROM NEW.stage
     AND NEW.stage = 'approved'::public.post_stage THEN
    target := COALESCE(NEW.assignee_id, NEW.created_by);
    IF target IS NOT NULL
       AND target <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
       AND public.notification_prefs_allows(target, 'approval_decision') THEN
      INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
      VALUES (
        target, NEW.brand_id, 'approval_decision',
        'Post aprovado',
        NEW.title,
        '/customers/' || COALESCE(NEW.client_id::text, '') || '?post=' || NEW.id::text,
        jsonb_build_object('source','post','post_id', NEW.id, 'stage', NEW.stage)
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

--
-- Name: notify_task_assigned(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_task_assigned() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL
     AND NEW.assignee_id <> COALESCE(OLD.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND NEW.assignee_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     AND public.notification_prefs_allows(NEW.assignee_id, 'assignment')
  THEN
    INSERT INTO public.notifications (user_id, brand_id, kind, title, body, href, payload)
    VALUES (
      NEW.assignee_id, NEW.brand_id, 'assignment',
      'Nova tarefa atribuída',
      NEW.title,
      '/tasks?task=' || NEW.id::text,
      jsonb_build_object('source', 'task', 'task_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END $$;

--
-- Name: notify_task_mentions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_task_mentions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid uuid;
  task_title text;
  task_brand uuid;
BEGIN
  SELECT title, brand_id INTO task_title, task_brand FROM public.tasks WHERE id = NEW.task_id;
  IF NEW.mentions IS NOT NULL THEN
    FOREACH uid IN ARRAY NEW.mentions LOOP
      IF uid <> NEW.author_id AND public.notification_prefs_allows(uid, 'mention') THEN
        INSERT INTO public.notifications (user_id, brand_id, kind, title, body, href, payload)
        VALUES (
          uid, COALESCE(task_brand, NEW.brand_id), 'mention',
          'Você foi mencionado',
          coalesce(task_title, 'Tarefa') || ': ' || left(NEW.body, 140),
          '/tasks?task=' || NEW.task_id::text,
          jsonb_build_object('source', 'task_comment', 'task_id', NEW.task_id, 'comment_id', NEW.id)
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

--
-- Name: portal_approvals(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_approvals(_token text DEFAULT NULL::text, _status text DEFAULT 'all'::text, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT
      p.id, p.title, p.format, p.channels, p.scheduled_at, p.published_at, p.cover_url,
      p.reference_media, p.stage,
      jsonb_build_object(
        'status', COALESCE(a.status::text, 'pending'),
        'notes', a.notes,
        'decided_at', a.decided_at
      ) AS approval
    FROM public.posts p
    LEFT JOIN public.post_approvals a ON a.post_id = p.id
    WHERE p.brand_id = s.brand_id AND p.client_id = s.client_id
      AND p.visible_in_portal = true AND p.deleted_at IS NULL
      AND (
        _status = 'all'
        OR (_status = 'pending' AND (a.status IS NULL OR a.status = 'pending'))
        OR (_status = 'approved' AND a.status = 'approved')
        OR (_status = 'adjust' AND a.status = 'adjust')
      )
    ORDER BY p.scheduled_at ASC NULLS LAST
  ) x;
  RETURN rows;
END $$;

--
-- Name: portal_briefings(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_briefings(_token text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, token, label, expires_at, revoked_at, submitted_at, created_at
      FROM public.client_briefing_tokens
     WHERE brand_id = s.brand_id AND client_id = s.client_id
     ORDER BY created_at DESC
  ) x;
  RETURN rows;
END $$;

--
-- Name: portal_calendar(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_calendar(_token text DEFAULT NULL::text, _month text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE s record; m_start timestamptz; m_end timestamptz; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  IF _month IS NULL THEN
    m_start := date_trunc('month', now());
  ELSE
    m_start := (_month || '-01')::timestamptz;
  END IF;
  m_end := m_start + interval '1 month';
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, title, format, channels, scheduled_at, stage, cover_url
      FROM public.posts
     WHERE brand_id = s.brand_id AND client_id = s.client_id
       AND visible_in_portal = true AND deleted_at IS NULL
       AND scheduled_at >= m_start AND scheduled_at < m_end
     ORDER BY scheduled_at ASC
  ) x;
  RETURN rows;
END $$;

--
-- Name: portal_client_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_client_ids(_user_id uuid) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(array_agg(client_id ORDER BY created_at), '{}'::uuid[])
  FROM public.client_members
  WHERE user_id = _user_id AND role = 'portal_client';
$$;

--
-- Name: portal_decide(text, uuid, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_decide(_token text DEFAULT NULL::text, _post_id uuid DEFAULT NULL::uuid, _decision text DEFAULT NULL::text, _note text DEFAULT NULL::text, _identity text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  s record; pst record; existing_id uuid; now_ts timestamptz := now();
  _kind public.notification_kind;
  _title text;
  _session_mode boolean := (_token IS NULL OR length(trim(_token)) = 0);
  _uid uuid;
  _who text;
  _dedupe text;
  _note_clean text := NULLIF(trim(COALESCE(_note, '')), '');
BEGIN
  IF _decision NOT IN ('approved','rejected','adjust','comment') THEN RAISE EXCEPTION 'bad_decision'; END IF;
  IF _post_id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  -- Pedido de ajuste sem explicacao nao e acionavel pela equipe.
  IF _decision = 'adjust' AND _note_clean IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);

  IF _session_mode THEN
    _uid := auth.uid();
    SELECT NULLIF(trim(COALESCE(_identity, up.full_name, '')), '') INTO _who
      FROM public.user_profiles up WHERE up.id = _uid;
    _who := COALESCE(_who, 'Cliente');
  ELSE
    IF _identity IS NULL OR length(trim(_identity)) = 0 THEN RAISE EXCEPTION 'identity_required'; END IF;
    _who := _identity;
  END IF;

  SELECT id, title, stage, published_at, deleted_at, visible_in_portal
    INTO pst
    FROM public.posts
   WHERE id = _post_id AND brand_id = s.brand_id AND client_id = s.client_id;

  IF pst.id IS NULL OR pst.deleted_at IS NOT NULL OR pst.visible_in_portal IS NOT TRUE THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  IF _decision <> 'comment'
     AND (pst.published_at IS NOT NULL OR pst.stage = 'published') THEN
    RAISE EXCEPTION 'post_already_published';
  END IF;

  IF _decision <> 'comment' THEN
    SELECT id INTO existing_id FROM public.post_approvals WHERE post_id = _post_id;
    IF existing_id IS NOT NULL THEN
      UPDATE public.post_approvals SET
        status = _decision::approval_status,
        -- Ajuste nunca sobrescreve a nota anterior com vazio.
        notes = CASE WHEN _decision = 'adjust' THEN COALESCE(_note_clean, notes) ELSE _note END,
        decided_at = now_ts, decided_by_name = _who,
        decided_by = _uid
      WHERE id = existing_id;
    ELSE
      INSERT INTO public.post_approvals(post_id, status, notes, decided_at, decided_by_name, decided_by)
      VALUES (_post_id, _decision::approval_status,
              CASE WHEN _decision = 'adjust' THEN _note_clean ELSE _note END,
              now_ts, _who, _uid);
    END IF;
    IF _decision = 'approved' THEN
      UPDATE public.posts SET approved_at = now_ts, review_status = 'approved' WHERE id = _post_id;
    ELSIF _decision = 'rejected' THEN
      UPDATE public.posts SET review_status = 'rejected' WHERE id = _post_id;
    ELSIF _decision = 'adjust' THEN
      UPDATE public.posts SET review_status = 'rework',
             rework_notes = COALESCE(_note_clean, rework_notes)
       WHERE id = _post_id;
    END IF;
  END IF;

  INSERT INTO public.activity_events(brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
  VALUES (s.brand_id, s.client_id, _uid, 'post', _post_id, 'portal_' || _decision,
          jsonb_build_object('note', COALESCE(_note,''), 'by', _who, 'title', pst.title,
                             'mode', CASE WHEN _session_mode THEN 'login' ELSE 'token' END));

  _kind := CASE WHEN _decision = 'comment' THEN 'mention'::public.notification_kind ELSE 'approval_decision'::public.notification_kind END;
  _title := CASE _decision
      WHEN 'approved' THEN 'Cliente aprovou um post'
      WHEN 'rejected' THEN 'Cliente rejeitou um post'
      WHEN 'adjust'   THEN 'Cliente pediu ajustes'
      ELSE 'Cliente comentou um post'
    END;

  _dedupe := 'portal_decision:' || _post_id::text || ':' || _decision;

  INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload, dedupe_key)
  SELECT DISTINCT t.user_id, s.brand_id, _kind, _title,
         _who || ': ' || COALESCE(pst.title, 'post'),
         '/customers/' || s.client_id::text,
         jsonb_build_object('source','portal_decision','post_id', _post_id,
                            'client_id', s.client_id, 'decision', _decision, 'by', _who),
         _dedupe
    FROM (
      SELECT c.owner_user_id AS user_id
        FROM public.clients c
       WHERE c.id = s.client_id AND c.owner_user_id IS NOT NULL
      UNION
      SELECT cm.user_id
        FROM public.client_members cm
       WHERE cm.client_id = s.client_id AND cm.role <> 'portal_client'
      UNION
      SELECT bm.user_id
        FROM public.brand_members bm
       WHERE bm.brand_id = s.brand_id AND bm.role IN ('owner', 'manager')
    ) t
   WHERE t.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.brand_members bm2
                  WHERE bm2.brand_id = s.brand_id AND bm2.user_id = t.user_id)
  ON CONFLICT (user_id, kind, dedupe_key)
    WHERE read_at IS NULL AND dedupe_key IS NOT NULL
    DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END $$;

--
-- Name: portal_files(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_files(_token text DEFAULT NULL::text, _search text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE s record; rows jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO rows FROM (
    SELECT id, name, storage_path, mime_type, size_bytes, created_at
      FROM public.client_documents
     WHERE brand_id = s.brand_id AND client_id = s.client_id
       AND visible_to_client IS TRUE
       AND (_search IS NULL OR name ILIKE '%' || _search || '%')
     ORDER BY created_at DESC
  ) x;
  RETURN rows;
END $$;

--
-- Name: portal_metrics(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_metrics(_token text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE s record; month_start timestamptz := date_trunc('month', now());
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  RETURN (
    WITH p AS (
      SELECT id, stage, scheduled_at, published_at, approved_at
        FROM public.posts
       WHERE brand_id = s.brand_id AND client_id = s.client_id
         AND visible_in_portal = true AND deleted_at IS NULL
    ),
    a AS (
      SELECT post_id, status FROM public.post_approvals WHERE post_id IN (SELECT id FROM p)
    )
    SELECT jsonb_build_object(
      'pending', (
        SELECT count(*) FROM p LEFT JOIN a ON a.post_id = p.id
         WHERE a.status IS NULL OR a.status = 'pending'
      ),
      'approvedThisMonth', (SELECT count(*) FROM p WHERE approved_at >= month_start),
      'scheduled', (SELECT count(*) FROM p WHERE stage = 'scheduled' OR (scheduled_at IS NOT NULL AND published_at IS NULL)),
      'total', (SELECT count(*) FROM p)
    )
  );
END $$;

--
-- Name: portal_my_clients(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_my_clients() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
    SELECT cm.client_id, cm.brand_id, c.name AS client_name, b.name AS brand_name
      FROM public.client_members cm
      JOIN public.clients c ON c.id = cm.client_id
      JOIN public.brands b ON b.id = cm.brand_id
     WHERE cm.user_id = auth.uid() AND cm.role = 'portal_client'
     ORDER BY c.name
  ) x;
$$;

--
-- Name: portal_post(text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_post(_token text DEFAULT NULL::text, _post_id uuid DEFAULT NULL::uuid, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE s record; post_row jsonb; apprv jsonb;
BEGIN
  IF _post_id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT to_jsonb(p) INTO post_row FROM (
    SELECT id, title, copy, format, channels, scheduled_at, published_at, cover_url,
           reference_media, script, stage
      FROM public.posts
     WHERE id = _post_id AND brand_id = s.brand_id AND client_id = s.client_id
       AND visible_in_portal = true AND deleted_at IS NULL
  ) p;
  IF post_row IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  SELECT to_jsonb(a) INTO apprv FROM (
    SELECT status::text, notes, decided_at, decided_by_name
      FROM public.post_approvals WHERE post_id = _post_id
  ) a;
  RETURN jsonb_build_object('post', post_row, 'approval', apprv);
END $$;

--
-- Name: portal_rate_register_failure(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_rate_register_failure(_ip_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
  _max_fails constant int := 10;
  _window constant interval := interval '1 minute';
  _block constant interval := interval '15 minutes';
BEGIN
  IF _ip_hash IS NULL OR length(_ip_hash) < 8 THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after', 0);
  END IF;

  INSERT INTO public.portal_rate_limit (ip_hash, window_start, fail_count)
  VALUES (_ip_hash, now(), 1)
  ON CONFLICT (ip_hash) DO UPDATE
    SET fail_count = CASE
          WHEN public.portal_rate_limit.window_start < now() - _window THEN 1
          ELSE public.portal_rate_limit.fail_count + 1
        END,
        window_start = CASE
          WHEN public.portal_rate_limit.window_start < now() - _window THEN now()
          ELSE public.portal_rate_limit.window_start
        END,
        updated_at = now()
  RETURNING * INTO r;

  IF r.fail_count >= _max_fails THEN
    UPDATE public.portal_rate_limit
       SET blocked_until = now() + _block, updated_at = now()
     WHERE ip_hash = _ip_hash
     RETURNING * INTO r;
  END IF;

  -- limpeza oportunista
  DELETE FROM public.portal_rate_limit
   WHERE updated_at < now() - interval '1 day'
     AND (blocked_until IS NULL OR blocked_until < now());

  RETURN jsonb_build_object(
    'blocked', r.blocked_until IS NOT NULL AND r.blocked_until > now(),
    'retry_after', GREATEST(0, ceil(extract(epoch FROM (COALESCE(r.blocked_until, now()) - now())))::int)
  );
END $$;

--
-- Name: portal_rate_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_rate_status(_ip_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE r record;
BEGIN
  IF _ip_hash IS NULL OR length(_ip_hash) < 8 THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after', 0);
  END IF;
  SELECT * INTO r FROM public.portal_rate_limit WHERE ip_hash = _ip_hash;
  IF NOT FOUND OR r.blocked_until IS NULL OR r.blocked_until <= now() THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after', 0);
  END IF;
  RETURN jsonb_build_object(
    'blocked', true,
    'retry_after', ceil(extract(epoch FROM (r.blocked_until - now())))::int
  );
END $$;

--
-- Name: portal_resolve(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_resolve(_token text DEFAULT NULL::text, _client_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE s record; res jsonb;
BEGIN
  SELECT * INTO s FROM public._portal_session_any(_token, _client_id);
  SELECT jsonb_build_object(
    'clientId', s.client_id,
    'brandId', s.brand_id,
    'client', jsonb_build_object(
      'id', cl.id,
      'name', cl.name,
      'niche', cl.niche,
      'color', cl.color,
      'socials', cl.socials,
      'contact_name', cl.contact_name,
      'contact_email', cl.contact_email,
      'logo_url', cl.logo_url,
      'portal_theme', cl.portal_theme
    ),
    'brand', jsonb_build_object('id', b.id, 'name', b.name)
  ) INTO res
  FROM public.clients cl, public.brands b
  WHERE cl.id = s.client_id AND b.id = s.brand_id;
  RETURN res;
END $$;

--
-- Name: posts_sync_legacy_stage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.posts_sync_legacy_stage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.stage_id IS NOT NULL THEN
    NEW.stage := public.derive_post_stage(NEW.stage_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: posts_touch_stage_entered_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.posts_touch_stage_entered_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_entered_at IS NULL THEN
      NEW.stage_entered_at := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      NEW.stage_entered_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: process_brain_learning_queue(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_brain_learning_queue(_limit integer DEFAULT 200) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_started    timestamptz := clock_timestamp();
  v_run_id     uuid;
  v_batch      uuid[];
  v_row        record;
  v_picked     integer := 0;
  v_processed  integer := 0;
  v_discarded  integer := 0;
  v_failed     integer := 0;
  v_orphans    integer := 0;
  v_created    integer := 0;
  v_updated    integer := 0;
  v_insights   integer := 0;
  v_edges      integer := 0;
  v_touched    integer := 0;
  v_alpha      numeric := 0.15;
  v_mem_id     uuid;
  v_was_new    boolean;
  v_scope_client uuid;
  v_ent_type   text;
  v_ent_id     uuid;
  v_category   text;
  v_title      text;
  v_counter    text;
  v_evidence   numeric;
  v_cons       integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('brain_learning_worker')) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'locked');
  END IF;

  INSERT INTO public.brain_worker_runs (job_name, status, started_at)
  VALUES ('brain_learning_worker', 'running', now())
  RETURNING id INTO v_run_id;

  WITH picked AS (
    SELECT id FROM public.brain_learning_queue
     WHERE status = 'queued'
     ORDER BY enqueued_at ASC
     LIMIT GREATEST(1, LEAST(_limit, 1000))
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.brain_learning_queue q
       SET status='processing', started_at=now(), attempts=q.attempts+1
      FROM picked
     WHERE q.id = picked.id
     RETURNING q.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_batch FROM upd;

  v_picked := COALESCE(array_length(v_batch, 1), 0);

  -- Órfãos: evento de origem inexistente (ex.: partição podada/arquivada).
  -- Terminal imediato, sem retry e sem voltar para a fila.
  WITH o AS (
    UPDATE public.brain_learning_queue q
       SET status = 'skipped',
           processed_at = now(),
           started_at = NULL,
           error = 'orphan: source brain_event no longer exists'
     WHERE q.id = ANY(v_batch)
       AND (q.event_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id))
     RETURNING 1
  ) SELECT COUNT(*) INTO v_orphans FROM o;

  FOR v_row IN
    SELECT q.id AS queue_id, e.*
      FROM public.brain_learning_queue q
      JOIN public.brain_events e ON e.id = q.event_id
     WHERE q.id = ANY(v_batch) AND q.status = 'processing'
  LOOP
    BEGIN
      INSERT INTO public.brain_metrics_snapshots
        (brand_id, channel, metric_name, metric_value, period_start, period_end)
      VALUES
        (v_row.brand_id, COALESCE(NULLIF(v_row.source_module,''),'system'),
         'events.' || v_row.event_type, 1,
         (v_row.created_at AT TIME ZONE 'UTC')::date,
         (v_row.created_at AT TIME ZONE 'UTC')::date)
      ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   COALESCE(channel, 'system'), metric_name, period_start)
      WHERE metric_name LIKE 'events.%'
      DO UPDATE SET metric_value = public.brain_metrics_snapshots.metric_value + 1;

      v_ent_type := NULL; v_ent_id := NULL; v_category := NULL;
      v_title := NULL; v_counter := NULL; v_evidence := NULL; v_scope_client := NULL;

      IF v_row.action IN ('approved','rejected','changes_requested','adjust','rework')
         AND v_row.client_id IS NOT NULL THEN
        v_scope_client := v_row.client_id;
        v_ent_type := 'client';
        v_ent_id   := v_row.client_id;
        v_category := 'padrao_de_aprovacao';
        v_title    := 'Padrão de decisão do cliente';
        v_counter  := CASE
                        WHEN v_row.action = 'approved' THEN 'approved'
                        WHEN v_row.action = 'rejected' THEN 'rejected'
                        ELSE 'adjust'
                      END;
        v_evidence := CASE WHEN v_row.action = 'approved' THEN 0.90 ELSE 0.35 END;

      ELSIF v_row.action IN ('published','delivered') AND v_row.brand_id IS NOT NULL THEN
        v_ent_type := 'brand';
        v_ent_id   := v_row.brand_id;
        v_category := 'cadencia_de_publicacao';
        v_title    := 'Cadência de publicação da marca';
        v_counter  := 'published';
        v_evidence := 0.85;

      ELSIF v_row.action IN ('overdue','failed','cancelled') AND v_row.brand_id IS NOT NULL THEN
        v_ent_type := 'brand';
        v_ent_id   := v_row.brand_id;
        v_category := 'riscos_operacionais';
        v_title    := 'Recorrência de atrasos e falhas';
        v_counter  := 'incident';
        v_evidence := 0.60;
      END IF;

      IF v_category IS NULL THEN
        v_discarded := v_discarded + 1;
      ELSE
        INSERT INTO public.brain_memory(
          brand_id, client_id, subject_type, subject_id, memory_type, scope, key,
          entity_type, entity_id, category, title, description,
          content, confidence, previous_confidence, reinforcement_count,
          source_event, source_refs, origin, status, tags, relations, metadata,
          access_count, last_accessed_at
        )
        VALUES (
          v_row.brand_id, v_scope_client, v_ent_type, v_ent_id, 'pattern',
          CASE WHEN v_scope_client IS NOT NULL THEN 'client'
               WHEN v_row.brand_id IS NULL THEN 'global' ELSE 'brand' END,
          v_ent_type || ':' || v_ent_id::text || ':' || v_category,
          v_ent_type, v_ent_id, v_category, v_title, '',
          jsonb_build_object(v_counter, 1, 'sample', 1,
                             'first_event_at', v_row.created_at,
                             'last_event_at', v_row.created_at),
          v_evidence, NULL, 1,
          v_row.id, jsonb_build_array(v_row.id), 'learning', 'active',
          ARRAY[v_category, v_ent_type]::text[], '[]'::jsonb,
          jsonb_build_object('source_module', v_row.source_module),
          1, now()
        )
        ON CONFLICT (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     entity_type, entity_id, category, title)
        DO UPDATE SET
          client_id           = COALESCE(public.brain_memory.client_id, EXCLUDED.client_id),
          previous_confidence = public.brain_memory.confidence,
          confidence          = GREATEST(0.05, LEAST(0.99,
            public.brain_memory.confidence + v_alpha * (v_evidence - public.brain_memory.confidence))),
          reinforcement_count = public.brain_memory.reinforcement_count + 1,
          access_count        = public.brain_memory.access_count + 1,
          last_accessed_at    = now(),
          updated_at          = now(),
          source_event        = v_row.id,
          status              = 'active',
          source_refs         = (
            CASE jsonb_typeof(public.brain_memory.source_refs)
              WHEN 'array' THEN
                CASE WHEN jsonb_array_length(public.brain_memory.source_refs) > 50
                     THEN '[]'::jsonb ELSE public.brain_memory.source_refs END
              ELSE '[]'::jsonb
            END) || jsonb_build_array(v_row.id),
          content = jsonb_set(
                      jsonb_set(
                        jsonb_set(COALESCE(public.brain_memory.content, '{}'::jsonb),
                          ARRAY[v_counter],
                          to_jsonb(COALESCE((public.brain_memory.content->>v_counter)::int, 0) + 1), true),
                        '{sample}',
                        to_jsonb(COALESCE((public.brain_memory.content->>'sample')::int, 0) + 1), true),
                      '{last_event_at}', to_jsonb(v_row.created_at), true)
        RETURNING id, (public.brain_memory.previous_confidence IS NULL)
        INTO v_mem_id, v_was_new;

        UPDATE public.brain_memory
           SET description = public.brain_render_memory_desc(category, content)
         WHERE id = v_mem_id;

        IF COALESCE(v_was_new, true) THEN
          v_created := v_created + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;

        v_edges := v_edges + COALESCE(public.derive_relationships_from_event(v_row.id), 0);
      END IF;

      IF v_row.action = 'rejected' AND v_row.client_id IS NOT NULL THEN
        IF (SELECT COUNT(*) FROM public.brain_events
             WHERE brand_id = v_row.brand_id AND client_id = v_row.client_id
               AND action = 'rejected' AND created_at >= now() - interval '24 hours') >= 3 THEN
          INSERT INTO public.brain_insights
            (brand_id, client_id, insight_type, description, confidence, based_on_events, expires_at)
          SELECT v_row.brand_id, v_row.client_id, 'client_rejection_spike',
                 'Cliente com 3+ rejeições em 24h — revisar briefing/direção criativa.',
                 0.85, 3, now() + interval '7 days'
          WHERE NOT EXISTS (
            SELECT 1 FROM public.brain_insights
             WHERE brand_id = v_row.brand_id AND client_id = v_row.client_id
               AND insight_type = 'client_rejection_spike'
               AND created_at >= now() - interval '24 hours');
          GET DIAGNOSTICS v_touched = ROW_COUNT;
          v_insights := v_insights + v_touched;
        END IF;
      END IF;

      IF v_row.action = 'overdue' AND v_row.project_id IS NOT NULL THEN
        INSERT INTO public.brain_insights
          (brand_id, client_id, insight_type, description, confidence, based_on_events, expires_at)
        SELECT v_row.brand_id, v_row.client_id, 'project_overdue_signal',
               'Projeto acumulando tarefas em atraso — recalcular capacidade.',
               0.8, 1, now() + interval '3 days'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.brain_insights
           WHERE brand_id = v_row.brand_id
             AND COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid)
               = COALESCE(v_row.client_id, '00000000-0000-0000-0000-000000000000'::uuid)
             AND insight_type = 'project_overdue_signal'
             AND created_at >= now() - interval '24 hours');
        GET DIAGNOSTICS v_touched = ROW_COUNT;
        v_insights := v_insights + v_touched;
      END IF;

      UPDATE public.brain_events SET processed_at = now() WHERE id = v_row.id;
      UPDATE public.brain_learning_queue
         SET status='done', processed_at=now(), error=NULL
       WHERE id = v_row.queue_id;

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.brain_learning_queue
         SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
             error  = SQLERRM,
             processed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END
       WHERE id = v_row.queue_id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  IF v_processed > 0 THEN
    BEGIN
      v_cons := public.consolidate_brain_memory(NULL);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.brain_worker_runs
         SET error = 'consolidate_failed: ' || SQLERRM
       WHERE id = v_run_id;
    END;
  END IF;

  DELETE FROM public.brain_learning_queue
   WHERE id IN (SELECT id FROM public.brain_learning_queue
                 WHERE status IN ('done','skipped') AND processed_at < now() - interval '7 days'
                 LIMIT 500);
  DELETE FROM public.brain_worker_runs
   WHERE started_at < now() - interval '14 days';

  UPDATE public.brain_worker_runs
     SET status = CASE WHEN v_failed > 0 THEN 'partial' ELSE 'ok' END,
         finished_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int),
         picked = v_picked, processed = v_processed, discarded = v_discarded + v_orphans,
         failed = v_failed, memories_created = v_created, memories_updated = v_updated,
         insights_created = v_insights, edges_created = v_edges
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'picked', v_picked, 'processed', v_processed, 'discarded', v_discarded,
    'orphans_skipped', v_orphans,
    'failed', v_failed, 'memories_created', v_created, 'memories_updated', v_updated,
    'insights', v_insights, 'edges', v_edges,
    'duration_ms', GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int));
END;
$$;

--
-- Name: protect_pipeline_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_pipeline_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_next uuid;
BEGIN
  IF OLD.is_default THEN
    SELECT id INTO v_next
      FROM public.content_pipelines
      WHERE client_id = OLD.client_id AND id <> OLD.id
      ORDER BY position ASC, created_at ASC
      LIMIT 1;
    IF v_next IS NULL THEN
      RAISE EXCEPTION 'cannot_delete_last_pipeline';
    END IF;
    UPDATE public.content_pipelines SET is_default = true WHERE id = v_next;
  END IF;
  RETURN OLD;
END $$;

--
-- Name: public_surface_rate_hit(text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.public_surface_rate_hit(_key text, _max integer DEFAULT 30, _window_seconds integer DEFAULT 300, _block_seconds integer DEFAULT 600) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
  win interval := make_interval(secs => GREATEST(_window_seconds, 1));
  blk interval := make_interval(secs => GREATEST(_block_seconds, 1));
BEGIN
  IF _key IS NULL OR length(_key) < 8 THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after', 0);
  END IF;

  SELECT * INTO r FROM public.portal_rate_limit WHERE ip_hash = _key FOR UPDATE;
  IF FOUND AND r.blocked_until IS NOT NULL AND r.blocked_until > now() THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'retry_after', ceil(extract(epoch FROM (r.blocked_until - now())))::int
    );
  END IF;

  INSERT INTO public.portal_rate_limit (ip_hash, window_start, fail_count)
  VALUES (_key, now(), 1)
  ON CONFLICT (ip_hash) DO UPDATE
    SET fail_count = CASE
          WHEN public.portal_rate_limit.window_start < now() - win THEN 1
          ELSE public.portal_rate_limit.fail_count + 1
        END,
        window_start = CASE
          WHEN public.portal_rate_limit.window_start < now() - win THEN now()
          ELSE public.portal_rate_limit.window_start
        END,
        blocked_until = CASE
          WHEN public.portal_rate_limit.blocked_until IS NOT NULL
           AND public.portal_rate_limit.blocked_until <= now() THEN NULL
          ELSE public.portal_rate_limit.blocked_until
        END,
        updated_at = now()
  RETURNING * INTO r;

  IF r.fail_count > _max THEN
    UPDATE public.portal_rate_limit
       SET blocked_until = now() + blk, updated_at = now()
     WHERE ip_hash = _key;
    RETURN jsonb_build_object('blocked', true, 'retry_after', GREATEST(_block_seconds, 1));
  END IF;

  RETURN jsonb_build_object('blocked', false, 'retry_after', 0, 'count', r.fail_count);
END $$;

--
-- Name: reactivate_portal_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reactivate_portal_token(_token_id uuid) RETURNS TABLE(id uuid, token text, label text, expires_at timestamp with time zone, revoked_at timestamp with time zone, last_seen_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_client uuid;
  v_brand uuid;
BEGIN
  SELECT pt.client_id, c.brand_id INTO v_client, v_brand
    FROM public.portal_tokens pt
    JOIN public.clients c ON c.id = pt.client_id
   WHERE pt.id = _token_id;
  IF v_client IS NULL THEN RAISE EXCEPTION 'portal_token_not_found'; END IF;
  IF NOT public.is_brand_admin_level(v_brand, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.portal_tokens
     WHERE client_id = v_client AND revoked_at IS NULL AND id <> _token_id
  ) THEN
    RAISE EXCEPTION 'active_token_exists';
  END IF;

  UPDATE public.portal_tokens pt
     SET revoked_at = NULL
   WHERE pt.id = _token_id;

  RETURN QUERY
    SELECT pt.id, pt.token, pt.label, pt.expires_at, pt.revoked_at, pt.last_seen_at, pt.created_at
      FROM public.portal_tokens pt WHERE pt.id = _token_id;
END;
$$;

--
-- Name: reap_brain_learning_queue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reap_brain_learning_queue() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n integer;
BEGIN
  WITH u AS (
    UPDATE public.brain_learning_queue q
       SET status = CASE
                      WHEN q.event_id IS NULL
                        OR NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id)
                        THEN 'skipped'
                      WHEN q.attempts >= 5 THEN 'failed'
                      ELSE 'queued'
                    END,
           error = CASE
                     WHEN q.event_id IS NULL
                       OR NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id)
                       THEN 'orphan: source brain_event no longer exists'
                     ELSE COALESCE(q.error, 'reaped: processing stalled')
                   END,
           processed_at = CASE
                            WHEN q.event_id IS NULL
                              OR NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id)
                              THEN now()
                            WHEN q.attempts >= 5 THEN now()
                            ELSE NULL
                          END,
           started_at = NULL
     WHERE q.status = 'processing' AND q.started_at < now() - interval '10 minutes'
     RETURNING 1
  ) SELECT COUNT(*) INTO n FROM u;
  RETURN n;
END $$;

--
-- Name: reap_stuck_ai_jobs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reap_stuck_ai_jobs() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  reaped integer;
BEGIN
  WITH updated AS (
    UPDATE public.ai_jobs
       SET status = 'failed',
           error = COALESCE(error, 'timeout: worker interrompido antes da conclusão'),
           finished_at = now(),
           step_label = NULL,
           updated_at = now()
     WHERE status IN ('queued','running')
       AND updated_at < now() - interval '5 minutes'
     RETURNING 1
  )
  SELECT count(*) INTO reaped FROM updated;
  RETURN reaped;
END;
$$;

--
-- Name: recalc_media_plan_item_amount(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalc_media_plan_item_amount() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  mb numeric(14,2);
BEGIN
  SELECT monthly_budget INTO mb FROM public.media_plans WHERE id = NEW.plan_id;
  NEW.budget_amount := ROUND(COALESCE(mb, 0) * COALESCE(NEW.budget_pct, 0) / 100.0, 2);
  RETURN NEW;
END;
$$;

--
-- Name: recalc_media_plan_items_on_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalc_media_plan_items_on_plan() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.monthly_budget IS DISTINCT FROM OLD.monthly_budget THEN
    UPDATE public.media_plan_items
       SET budget_amount = ROUND(NEW.monthly_budget * COALESCE(budget_pct,0) / 100.0, 2),
           updated_at = now()
     WHERE plan_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: refresh_brain_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_brain_stats() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.brain_stats_mv;
END;
$$;

--
-- Name: refresh_task_total_minutes(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_task_total_minutes(_task_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _total INTEGER;
BEGIN
  SELECT FLOOR(COALESCE(SUM(COALESCE(seconds, COALESCE(minutes, 0) * 60)), 0) / 60.0)::INT
    INTO _total
  FROM public.task_time_entries
  WHERE task_id = _task_id
    AND ended_at IS NOT NULL;

  UPDATE public.tasks
  SET total_minutes = _total,
      updated_at = now()
  WHERE id = _task_id;

  RETURN _total;
END;
$$;

--
-- Name: safe_uuid(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.safe_uuid(_txt text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
BEGIN
  IF _txt IS NULL OR _txt = '' THEN RETURN NULL; END IF;
  RETURN _txt::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

--
-- Name: set_cron_secret(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_cron_secret(_value text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid;
begin
  if _value is null or length(_value) < 16 then
    raise exception 'cron secret inválido';
  end if;
  select id into v_id from vault.secrets where name = 'cron_secret';
  if v_id is null then
    perform vault.create_secret(_value, 'cron_secret', 'Segredo compartilhado dos endpoints /api/public de cron');
  else
    perform vault.update_secret(v_id, _value, 'cron_secret', 'Segredo compartilhado dos endpoints /api/public de cron');
  end if;
end;
$$;

--
-- Name: start_timer(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_timer(_task_id uuid, _brand_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid UUID := auth.uid();
  _new_id UUID;
  _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthenticated'; END IF;
  IF NOT public.is_brand_member(_brand_id, _uid) AND NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = _task_id AND t.brand_id = _brand_id) THEN
    RAISE EXCEPTION 'task_out_of_workspace';
  END IF;
  IF NOT public.can_access_task(_task_id, _uid) THEN
    RAISE EXCEPTION 'task_out_of_scope';
  END IF;

  UPDATE public.task_time_entries
  SET ended_at = _now,
      seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at)))::INT),
      minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (_now - started_at)) / 60.0)::INT),
      ended_reason = 'auto'
  WHERE user_id = _uid AND ended_at IS NULL;

  INSERT INTO public.task_time_entries (task_id, user_id, brand_id, started_at, source)
  VALUES (_task_id, _uid, _brand_id, _now, 'timer')
  RETURNING id INTO _new_id;

  RETURN _new_id;
END; $$;

--
-- Name: stop_timer(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stop_timer(_entry_id uuid, _reason text DEFAULT 'stop'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid UUID := auth.uid();
  _secs INTEGER;
  _now TIMESTAMPTZ := now();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  UPDATE public.task_time_entries
  SET ended_at = _now,
      seconds = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (_now - started_at)))::INT),
      minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (_now - started_at)) / 60.0)::INT),
      ended_reason = CASE
        WHEN _reason IN ('pause', 'stop', 'auto') THEN _reason
        ELSE 'stop'
      END
  WHERE id = _entry_id
    AND user_id = _uid
    AND ended_at IS NULL
  RETURNING seconds INTO _secs;

  RETURN COALESCE(_secs, 0);
END;
$$;

--
-- Name: storage_scope_allows(text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.storage_scope_allows(_bucket text, _name text, _write boolean) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _brand uuid;
  _client uuid;
BEGIN
  IF _uid IS NULL OR _name IS NULL THEN RETURN false; END IF;
  IF _bucket NOT IN ('brand-assets', 'brand-documents', 'brand-media') THEN RETURN false; END IF;
  IF public.is_super_admin(_uid) THEN RETURN true; END IF;

  _brand := public.safe_uuid(split_part(_name, '/', 1));
  IF _brand IS NULL THEN RETURN false; END IF;

  _client := public.safe_uuid(split_part(_name, '/', 2));

  IF _client IS NOT NULL THEN
    -- Relacionamento real marca↔cliente (bloqueia troca manual de segmentos).
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c WHERE c.id = _client AND c.brand_id = _brand
    ) THEN
      RETURN false;
    END IF;

    -- PORTAL: somente leitura do próprio cliente, e só o que é liberado.
    IF public.is_portal_client_of(_client, _uid) THEN
      IF _write THEN RETURN false; END IF;
      IF _bucket = 'brand-documents' THEN
        RETURN EXISTS (
          SELECT 1 FROM public.client_documents d
          WHERE d.storage_path = _name
            AND d.client_id = _client
            AND d.visible_to_client IS TRUE
        );
      END IF;
      -- identidade visual do próprio cliente
      RETURN _bucket = 'brand-assets';
    END IF;

    -- Interno: ADMIN = workspace inteiro; MANAGER/USER = clientes atribuídos.
    RETURN public.client_in_scope(_client, _brand);
  END IF;

  -- Sem cliente determinável (branding do workspace): mantém o mais restritivo.
  -- Não existe fallback "brand member = pode acessar".
  RETURN public.is_brand_admin_level(_brand, _uid);
END $$;

--
-- Name: sync_post_publication_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_post_publication_state(p_post_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_pending   integer;
  v_ts        timestamptz;
  v_pipeline  uuid;
  v_stage_id  uuid;
  v_unpub     integer;
BEGIN
  IF p_post_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.post_placements pp
     SET status = 'published',
         published_at = COALESCE(pp.published_at, sp.published_at, now()),
         updated_at = now()
    FROM public.social_posts sp
   WHERE sp.post_id = p_post_id
     AND sp.status = 'published'
     AND pp.post_id = p_post_id
     AND pp.connection_id = sp.connection_id
     AND (
       (sp.placement = 'story' AND pp.format = 'stories')
       OR (sp.placement <> 'story' AND pp.format <> 'stories')
     )
     AND pp.status <> 'published';

  UPDATE public.post_placements pp
     SET status = 'failed',
         updated_at = now()
    FROM public.social_posts sp
   WHERE sp.post_id = p_post_id
     AND sp.status = 'failed'
     AND pp.post_id = p_post_id
     AND pp.connection_id = sp.connection_id
     AND (
       (sp.placement = 'story' AND pp.format = 'stories')
       OR (sp.placement <> 'story' AND pp.format <> 'stories')
     )
     AND pp.status NOT IN ('published', 'failed');

  UPDATE public.post_placements pp
     SET status = 'connection_required',
         updated_at = now()
    FROM public.social_posts sp
   WHERE sp.post_id = p_post_id
     AND sp.status = 'blocked'
     AND pp.post_id = p_post_id
     AND pp.connection_id = sp.connection_id
     AND (
       (sp.placement = 'story' AND pp.format = 'stories')
       OR (sp.placement <> 'story' AND pp.format <> 'stories')
     )
     AND pp.status NOT IN ('published', 'connection_required');

  -- Guarda de publicação parcial: se existe destino não publicado, a peça NUNCA
  -- pode permanecer marcada como publicada (mesmo que tenha sido marcada antes).
  SELECT count(*) INTO v_unpub
    FROM public.post_placements
   WHERE post_id = p_post_id
     AND status <> 'published';

  IF v_unpub > 0 THEN
    UPDATE public.posts
       SET stage = 'scheduled',
           published_at = NULL,
           updated_at = now()
     WHERE id = p_post_id
       AND stage = 'published';
    RETURN;
  END IF;

  SELECT count(*) INTO v_pending
    FROM public.social_posts
   WHERE post_id = p_post_id
     AND status IN ('draft', 'scheduled', 'publishing', 'blocked');
  IF v_pending > 0 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.social_posts
     WHERE post_id = p_post_id
       AND status = 'failed'
  ) THEN
    RETURN;
  END IF;

  SELECT max(published_at) INTO v_ts
    FROM public.social_posts
   WHERE post_id = p_post_id
     AND status = 'published';
  IF v_ts IS NULL THEN
    RETURN;
  END IF;

  SELECT pipeline_id INTO v_pipeline FROM public.posts WHERE id = p_post_id;
  IF v_pipeline IS NOT NULL THEN
    SELECT id INTO v_stage_id
      FROM public.content_pipeline_stages
     WHERE pipeline_id = v_pipeline
       AND key = 'published'
     ORDER BY position
     LIMIT 1;
  END IF;

  UPDATE public.posts
     SET stage = 'published',
         published_at = COALESCE(published_at, v_ts),
         stage_id = COALESCE(v_stage_id, stage_id),
         updated_at = now()
   WHERE id = p_post_id
     AND (
       stage <> 'published'
       OR published_at IS NULL
       OR (v_stage_id IS NOT NULL AND stage_id IS DISTINCT FROM v_stage_id)
     );
END;
$$;

--
-- Name: tg_ai_usage_limits_touch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_ai_usage_limits_touch() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

--
-- Name: tg_social_posts_sync_publication(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_social_posts_sync_publication() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published')
     AND NEW.post_id IS NOT NULL THEN
    PERFORM public.sync_post_publication_state(NEW.post_id);
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: tg_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

--
-- Name: trg_time_entry_refresh_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_time_entry_refresh_totals() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_task_total_minutes(OLD.task_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_task_total_minutes(NEW.task_id);
  IF TG_OP = 'UPDATE' AND NEW.task_id <> OLD.task_id THEN
    PERFORM public.refresh_task_total_minutes(OLD.task_id);
  END IF;
  RETURN NEW;
END; $$;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

--
-- Name: upsert_brain_relationship(uuid, text, uuid, text, uuid, text, numeric, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_brain_relationship(_brand_id uuid, _from_type text, _from_id uuid, _to_type text, _to_id uuid, _rel_type text, _strength_delta numeric DEFAULT 0.05, _metadata jsonb DEFAULT '{}'::jsonb, _bidirectional boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _from_id IS NULL OR _to_id IS NULL OR _from_type IS NULL OR _to_type IS NULL THEN
    RETURN NULL;
  END IF;
  IF _from_type = _to_type AND _from_id = _to_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.brain_relationships
    (brand_id, from_type, from_id, to_type, to_id, relationship_type,
     strength, confidence, bidirectional, metadata, observation_count, last_observed_at)
  VALUES
    (_brand_id, _from_type, _from_id, _to_type, _to_id, _rel_type,
     LEAST(1.0, GREATEST(0.05, _strength_delta)), 0.5, _bidirectional, _metadata, 1, now())
  ON CONFLICT (
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    from_type, from_id, to_type, to_id, relationship_type
  ) DO UPDATE SET
    strength = LEAST(1.0, public.brain_relationships.strength + _strength_delta),
    confidence = LEAST(0.99, public.brain_relationships.confidence + 0.02),
    observation_count = public.brain_relationships.observation_count + 1,
    last_observed_at = now(),
    metadata = public.brain_relationships.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

--
-- Name: upsert_social_connection(uuid, text, text, text, text, text, text, text, text, text, text, text, text[], timestamp with time zone, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_social_connection(_brand_id uuid, _provider text, _channel text, _external_id text, _access_token_ciphertext text, _external_name text DEFAULT NULL::text, _account_username text DEFAULT NULL::text, _page_id text DEFAULT NULL::text, _instagram_business_id text DEFAULT NULL::text, _meta_user_id text DEFAULT NULL::text, _owner_external_id text DEFAULT NULL::text, _owner_name text DEFAULT NULL::text, _scopes text[] DEFAULT '{}'::text[], _token_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _metadata jsonb DEFAULT '{}'::jsonb, _created_by uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.social_connections (
    brand_id, provider, channel, external_id, external_name, account_id, account_username,
    owner_external_id, owner_name, access_token_ciphertext, scopes, token_expires_at,
    status, metadata, created_by, page_id, instagram_business_id, meta_user_id, channel_name
  ) VALUES (
    _brand_id, _provider, _channel, _external_id, _external_name, _external_id, _account_username,
    _owner_external_id, _owner_name, _access_token_ciphertext, COALESCE(_scopes,'{}'), _token_expires_at,
    'active', COALESCE(_metadata,'{}'::jsonb), _created_by, _page_id, _instagram_business_id, _meta_user_id,
    COALESCE(_account_username, _external_name)
  )
  ON CONFLICT (brand_id, provider, channel, external_id) DO UPDATE SET
    external_name = COALESCE(EXCLUDED.external_name, public.social_connections.external_name),
    account_username = COALESCE(EXCLUDED.account_username, public.social_connections.account_username),
    owner_external_id = COALESCE(EXCLUDED.owner_external_id, public.social_connections.owner_external_id),
    owner_name = COALESCE(EXCLUDED.owner_name, public.social_connections.owner_name),
    access_token_ciphertext = EXCLUDED.access_token_ciphertext,
    scopes = EXCLUDED.scopes,
    token_expires_at = EXCLUDED.token_expires_at,
    status = 'active',
    last_error = NULL,
    metadata = public.social_connections.metadata || EXCLUDED.metadata,
    page_id = COALESCE(EXCLUDED.page_id, public.social_connections.page_id),
    instagram_business_id = COALESCE(EXCLUDED.instagram_business_id, public.social_connections.instagram_business_id),
    meta_user_id = COALESCE(EXCLUDED.meta_user_id, public.social_connections.meta_user_id),
    channel_name = COALESCE(EXCLUDED.channel_name, public.social_connections.channel_name),
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

--
-- Name: validate_client_social_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_client_social_account() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  conn_brand uuid;
  cli_brand uuid;
BEGIN
  SELECT brand_id INTO conn_brand FROM public.social_connections WHERE id = NEW.connection_id;
  SELECT brand_id INTO cli_brand FROM public.clients WHERE id = NEW.client_id;
  IF conn_brand IS NULL OR cli_brand IS NULL THEN
    RAISE EXCEPTION 'Canal ou cliente inexistente';
  END IF;
  IF conn_brand <> cli_brand OR NEW.brand_id <> conn_brand THEN
    RAISE EXCEPTION 'Canal e cliente devem pertencer a mesma marca';
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: validate_placement_connection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_placement_connection() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  ok boolean;
BEGIN
  IF NEW.connection_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.client_social_accounts csa
    JOIN public.social_connections sc ON sc.id = csa.connection_id
    WHERE csa.connection_id = NEW.connection_id
      AND csa.client_id = NEW.client_id
      AND sc.brand_id = NEW.brand_id
  ) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'Canal nao vinculado a este cliente (client_social_accounts)';
  END IF;
  RETURN NEW;
END;
$$;


-- ============================ VIEWS / MATERIALIZED VIEWS (1) ============================

--
-- Name: brain_stats_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.brain_stats_mv AS
 SELECT id AS brand_id,
    COALESCE(( SELECT count(*) AS count
           FROM public.posts p
          WHERE ((p.brand_id = b.id) AND (p.deleted_at IS NULL))), (0)::bigint) AS posts,
    COALESCE(( SELECT count(*) AS count
           FROM public.tasks t
          WHERE (t.brand_id = b.id)), (0)::bigint) AS tasks,
    COALESCE(( SELECT count(*) AS count
           FROM public.projects pr
          WHERE (pr.brand_id = b.id)), (0)::bigint) AS projects,
    now() AS refreshed_at
   FROM public.brands b
  WITH NO DATA;


-- ============================ COLUMN DEFAULTS / OTHER ALTERS (1) ============================

ALTER TABLE ONLY public.ai_jobs REPLICA IDENTITY FULL;


-- ============================ CONSTRAINTS (PK / UNIQUE / CHECK) (114) ============================

--
-- Name: activity_events activity_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_pkey PRIMARY KEY (id);

--
-- Name: agent_prompt_overrides agent_prompt_overrides_brand_id_agent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompt_overrides
    ADD CONSTRAINT agent_prompt_overrides_brand_id_agent_id_key UNIQUE (brand_id, agent_id);

--
-- Name: agent_prompt_overrides agent_prompt_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompt_overrides
    ADD CONSTRAINT agent_prompt_overrides_pkey PRIMARY KEY (id);

--
-- Name: agent_prompts agent_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompts
    ADD CONSTRAINT agent_prompts_pkey PRIMARY KEY (agent_id);

--
-- Name: ai_jobs ai_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_jobs
    ADD CONSTRAINT ai_jobs_pkey PRIMARY KEY (id);

--
-- Name: ai_model_catalog_overrides ai_model_catalog_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_model_catalog_overrides
    ADD CONSTRAINT ai_model_catalog_overrides_pkey PRIMARY KEY (id);

--
-- Name: ai_model_catalog_overrides ai_model_catalog_overrides_provider_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_model_catalog_overrides
    ADD CONSTRAINT ai_model_catalog_overrides_provider_role_key UNIQUE (provider, role);

--
-- Name: ai_model_health ai_model_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_model_health
    ADD CONSTRAINT ai_model_health_pkey PRIMARY KEY (id);

--
-- Name: ai_usage_limits ai_usage_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_limits
    ADD CONSTRAINT ai_usage_limits_pkey PRIMARY KEY (id);

--
-- Name: brain_embeddings brain_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_embeddings
    ADD CONSTRAINT brain_embeddings_pkey PRIMARY KEY (id);

--
-- Name: brain_events brain_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_events
    ADD CONSTRAINT brain_events_pkey PRIMARY KEY (id);

--
-- Name: brain_insights brain_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_insights
    ADD CONSTRAINT brain_insights_pkey PRIMARY KEY (id);

--
-- Name: brain_learning_queue brain_learning_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_learning_queue
    ADD CONSTRAINT brain_learning_queue_pkey PRIMARY KEY (id);

--
-- Name: brain_memory brain_memory_brand_id_subject_type_subject_id_memory_type_k_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_memory
    ADD CONSTRAINT brain_memory_brand_id_subject_type_subject_id_memory_type_k_key UNIQUE (brand_id, subject_type, subject_id, memory_type, key);

--
-- Name: brain_memory brain_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_memory
    ADD CONSTRAINT brain_memory_pkey PRIMARY KEY (id);

--
-- Name: brain_memory_versions brain_memory_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_memory_versions
    ADD CONSTRAINT brain_memory_versions_pkey PRIMARY KEY (id);

--
-- Name: brain_metrics_snapshots brain_metrics_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_metrics_snapshots
    ADD CONSTRAINT brain_metrics_snapshots_pkey PRIMARY KEY (id);

--
-- Name: brain_reasoning_logs brain_reasoning_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_reasoning_logs
    ADD CONSTRAINT brain_reasoning_logs_pkey PRIMARY KEY (id);

--
-- Name: brain_recommendations brain_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_recommendations
    ADD CONSTRAINT brain_recommendations_pkey PRIMARY KEY (id);

--
-- Name: brain_relationships brain_relationships_brand_id_from_type_from_id_to_type_to_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_relationships
    ADD CONSTRAINT brain_relationships_brand_id_from_type_from_id_to_type_to_i_key UNIQUE (brand_id, from_type, from_id, to_type, to_id, relationship_type);

--
-- Name: brain_relationships brain_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_relationships
    ADD CONSTRAINT brain_relationships_pkey PRIMARY KEY (id);

--
-- Name: brain_retention_config brain_retention_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_retention_config
    ADD CONSTRAINT brain_retention_config_pkey PRIMARY KEY (key);

--
-- Name: brain_worker_runs brain_worker_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_worker_runs
    ADD CONSTRAINT brain_worker_runs_pkey PRIMARY KEY (id);

--
-- Name: brand_ai_content brand_ai_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_content
    ADD CONSTRAINT brand_ai_content_pkey PRIMARY KEY (id);

--
-- Name: brand_ai_usage brand_ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_usage
    ADD CONSTRAINT brand_ai_usage_pkey PRIMARY KEY (id);

--
-- Name: brand_ai_versions brand_ai_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_versions
    ADD CONSTRAINT brand_ai_versions_pkey PRIMARY KEY (id);

--
-- Name: brand_api_credentials brand_api_credentials_brand_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_api_credentials
    ADD CONSTRAINT brand_api_credentials_brand_id_provider_key UNIQUE (brand_id, provider);

--
-- Name: brand_api_credentials brand_api_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_api_credentials
    ADD CONSTRAINT brand_api_credentials_pkey PRIMARY KEY (id);

--
-- Name: brand_briefing_proposals brand_briefing_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_proposals
    ADD CONSTRAINT brand_briefing_proposals_pkey PRIMARY KEY (id);

--
-- Name: brand_briefing_requests brand_briefing_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_requests
    ADD CONSTRAINT brand_briefing_requests_pkey PRIMARY KEY (id);

--
-- Name: brand_briefing_reviews brand_briefing_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_reviews
    ADD CONSTRAINT brand_briefing_reviews_pkey PRIMARY KEY (id);

--
-- Name: brand_briefing_versions brand_briefing_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_versions
    ADD CONSTRAINT brand_briefing_versions_pkey PRIMARY KEY (id);

--
-- Name: brand_briefings brand_briefings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefings
    ADD CONSTRAINT brand_briefings_pkey PRIMARY KEY (id);

--
-- Name: brand_cohorts brand_cohorts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_cohorts
    ADD CONSTRAINT brand_cohorts_pkey PRIMARY KEY (id);

--
-- Name: brand_competitors brand_competitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_competitors
    ADD CONSTRAINT brand_competitors_pkey PRIMARY KEY (id);

--
-- Name: brand_connections brand_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_connections
    ADD CONSTRAINT brand_connections_pkey PRIMARY KEY (brand_id);

--
-- Name: brand_features brand_features_brand_id_feature_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_features
    ADD CONSTRAINT brand_features_brand_id_feature_key_key UNIQUE (brand_id, feature_key);

--
-- Name: brand_features brand_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_features
    ADD CONSTRAINT brand_features_pkey PRIMARY KEY (id);

--
-- Name: brand_invites brand_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_invites
    ADD CONSTRAINT brand_invites_pkey PRIMARY KEY (id);

--
-- Name: brand_invites brand_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_invites
    ADD CONSTRAINT brand_invites_token_key UNIQUE (token);

--
-- Name: brand_journey_stage_templates brand_journey_stage_templates_brand_id_stage_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_journey_stage_templates
    ADD CONSTRAINT brand_journey_stage_templates_brand_id_stage_key UNIQUE (brand_id, stage);

--
-- Name: brand_journey_stage_templates brand_journey_stage_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_journey_stage_templates
    ADD CONSTRAINT brand_journey_stage_templates_pkey PRIMARY KEY (id);

--
-- Name: brand_media_assets brand_media_assets_brand_id_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_media_assets
    ADD CONSTRAINT brand_media_assets_brand_id_storage_path_key UNIQUE (brand_id, storage_path);

--
-- Name: brand_media_assets brand_media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_media_assets
    ADD CONSTRAINT brand_media_assets_pkey PRIMARY KEY (id);

--
-- Name: brand_members brand_members_brand_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_members
    ADD CONSTRAINT brand_members_brand_id_user_id_key UNIQUE (brand_id, user_id);

--
-- Name: brand_members brand_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_members
    ADD CONSTRAINT brand_members_pkey PRIMARY KEY (id);

--
-- Name: brand_pautas brand_pautas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_pautas
    ADD CONSTRAINT brand_pautas_pkey PRIMARY KEY (id);

--
-- Name: brand_personas brand_personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_personas
    ADD CONSTRAINT brand_personas_pkey PRIMARY KEY (id);

--
-- Name: brand_swot brand_swot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_swot
    ADD CONSTRAINT brand_swot_pkey PRIMARY KEY (id);

--
-- Name: brand_voice_cards brand_voice_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_voice_cards
    ADD CONSTRAINT brand_voice_cards_pkey PRIMARY KEY (id);

--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);

--
-- Name: brands brands_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_slug_key UNIQUE (slug);

--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);

--
-- Name: card_approval_events card_approval_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_events
    ADD CONSTRAINT card_approval_events_pkey PRIMARY KEY (id);

--
-- Name: card_approval_tokens card_approval_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_tokens
    ADD CONSTRAINT card_approval_tokens_pkey PRIMARY KEY (id);

--
-- Name: card_approval_tokens card_approval_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_tokens
    ADD CONSTRAINT card_approval_tokens_token_key UNIQUE (token);

--
-- Name: chat_conversations chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_pkey PRIMARY KEY (id);

--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

--
-- Name: client_briefing_tokens client_briefing_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_briefing_tokens
    ADD CONSTRAINT client_briefing_tokens_pkey PRIMARY KEY (id);

--
-- Name: client_briefing_tokens client_briefing_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_briefing_tokens
    ADD CONSTRAINT client_briefing_tokens_token_key UNIQUE (token);

--
-- Name: client_briefings client_briefings_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_briefings
    ADD CONSTRAINT client_briefings_client_id_key UNIQUE (client_id);

--
-- Name: client_briefings client_briefings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_briefings
    ADD CONSTRAINT client_briefings_pkey PRIMARY KEY (id);

--
-- Name: client_documents client_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_documents
    ADD CONSTRAINT client_documents_pkey PRIMARY KEY (id);

--
-- Name: client_journey_events client_journey_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_journey_events
    ADD CONSTRAINT client_journey_events_pkey PRIMARY KEY (id);

--
-- Name: client_members client_members_client_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_members
    ADD CONSTRAINT client_members_client_id_user_id_key UNIQUE (client_id, user_id);

--
-- Name: client_members client_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_members
    ADD CONSTRAINT client_members_pkey PRIMARY KEY (id);

--
-- Name: client_social_accounts client_social_accounts_client_id_connection_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_client_id_connection_id_key UNIQUE (client_id, connection_id);

--
-- Name: client_social_accounts client_social_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_pkey PRIMARY KEY (id);

--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);

--
-- Name: content_pipeline_stages content_pipeline_stages_pipeline_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pipeline_stages
    ADD CONSTRAINT content_pipeline_stages_pipeline_id_key_key UNIQUE (pipeline_id, key);

--
-- Name: content_pipeline_stages content_pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pipeline_stages
    ADD CONSTRAINT content_pipeline_stages_pkey PRIMARY KEY (id);

--
-- Name: content_pipelines content_pipelines_client_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pipelines
    ADD CONSTRAINT content_pipelines_client_id_slug_key UNIQUE (client_id, slug);

--
-- Name: content_pipelines content_pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pipelines
    ADD CONSTRAINT content_pipelines_pkey PRIMARY KEY (id);

--
-- Name: evolution_events evolution_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_events
    ADD CONSTRAINT evolution_events_pkey PRIMARY KEY (id);

--
-- Name: evolution_instances evolution_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_instances
    ADD CONSTRAINT evolution_instances_pkey PRIMARY KEY (id);

--
-- Name: feature_catalog feature_catalog_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_catalog
    ADD CONSTRAINT feature_catalog_key_key UNIQUE (key);

--
-- Name: feature_catalog feature_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_catalog
    ADD CONSTRAINT feature_catalog_pkey PRIMARY KEY (id);

--
-- Name: installation installation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installation
    ADD CONSTRAINT installation_pkey PRIMARY KEY (id);

--
-- Name: media_plan_items media_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_plan_items
    ADD CONSTRAINT media_plan_items_pkey PRIMARY KEY (id);

--
-- Name: media_plans media_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_plans
    ADD CONSTRAINT media_plans_pkey PRIMARY KEY (id);

--
-- Name: media_plans media_plans_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_plans
    ADD CONSTRAINT media_plans_share_token_key UNIQUE (share_token);

--
-- Name: message_logs message_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_logs
    ADD CONSTRAINT message_logs_pkey PRIMARY KEY (id);

--
-- Name: message_templates message_templates_brand_id_event_key_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_brand_id_event_key_channel_key UNIQUE (brand_id, event_key, channel);

--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);

--
-- Name: meta_compliance_events meta_compliance_events_confirmation_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_compliance_events
    ADD CONSTRAINT meta_compliance_events_confirmation_code_key UNIQUE (confirmation_code);

--
-- Name: meta_compliance_events meta_compliance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_compliance_events
    ADD CONSTRAINT meta_compliance_events_pkey PRIMARY KEY (id);

--
-- Name: meta_oauth_sessions meta_oauth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_oauth_sessions
    ADD CONSTRAINT meta_oauth_sessions_pkey PRIMARY KEY (id);

--
-- Name: monthly_plan_tokens monthly_plan_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plan_tokens
    ADD CONSTRAINT monthly_plan_tokens_pkey PRIMARY KEY (id);

--
-- Name: monthly_plan_tokens monthly_plan_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plan_tokens
    ADD CONSTRAINT monthly_plan_tokens_token_key UNIQUE (token);

--
-- Name: monthly_plan_topics monthly_plan_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plan_topics
    ADD CONSTRAINT monthly_plan_topics_pkey PRIMARY KEY (id);

--
-- Name: monthly_plans monthly_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plans
    ADD CONSTRAINT monthly_plans_pkey PRIMARY KEY (id);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: plan_overage_requests plan_overage_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_overage_requests
    ADD CONSTRAINT plan_overage_requests_pkey PRIMARY KEY (id);

--
-- Name: portal_rate_limit portal_rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_rate_limit
    ADD CONSTRAINT portal_rate_limit_pkey PRIMARY KEY (ip_hash);

--
-- Name: portal_tokens portal_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_tokens
    ADD CONSTRAINT portal_tokens_pkey PRIMARY KEY (id);

--
-- Name: portal_tokens portal_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_tokens
    ADD CONSTRAINT portal_tokens_token_key UNIQUE (token);

--
-- Name: post_approvals post_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_approvals
    ADD CONSTRAINT post_approvals_pkey PRIMARY KEY (id);

--
-- Name: post_placements post_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_placements
    ADD CONSTRAINT post_placements_pkey PRIMARY KEY (id);

--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);

--
-- Name: project_jobs project_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_jobs
    ADD CONSTRAINT project_jobs_pkey PRIMARY KEY (id);

--
-- Name: project_template_jobs project_template_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_template_jobs
    ADD CONSTRAINT project_template_jobs_pkey PRIMARY KEY (id);

--
-- Name: project_template_tasks project_template_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_template_tasks
    ADD CONSTRAINT project_template_tasks_pkey PRIMARY KEY (id);

--
-- Name: project_templates project_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_templates
    ADD CONSTRAINT project_templates_pkey PRIMARY KEY (id);

--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);

--
-- Name: sla_rules sla_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_rules
    ADD CONSTRAINT sla_rules_pkey PRIMARY KEY (id);

--
-- Name: social_connections social_connections_brand_id_provider_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_connections
    ADD CONSTRAINT social_connections_brand_id_provider_external_id_key UNIQUE (brand_id, provider, external_id);

--
-- Name: social_connections social_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_connections
    ADD CONSTRAINT social_connections_pkey PRIMARY KEY (id);

--
-- Name: social_posts social_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_pkey PRIMARY KEY (id);

--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);

--
-- Name: task_subtasks task_subtasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT task_subtasks_pkey PRIMARY KEY (id);

--
-- Name: task_time_entries task_time_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_time_entries
    ADD CONSTRAINT task_time_entries_pkey PRIMARY KEY (id);

--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);

--
-- Name: whatsapp_recipients whatsapp_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_recipients
    ADD CONSTRAINT whatsapp_recipients_pkey PRIMARY KEY (id);


-- ============================ FOREIGN KEYS (194) ============================

--
-- Name: activity_events activity_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: activity_events activity_events_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: activity_events activity_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

--
-- Name: agent_prompt_overrides agent_prompt_overrides_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompt_overrides
    ADD CONSTRAINT agent_prompt_overrides_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: agent_prompt_overrides agent_prompt_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompt_overrides
    ADD CONSTRAINT agent_prompt_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: ai_jobs ai_jobs_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_jobs
    ADD CONSTRAINT ai_jobs_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: ai_jobs ai_jobs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_jobs
    ADD CONSTRAINT ai_jobs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: ai_usage_limits ai_usage_limits_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_limits
    ADD CONSTRAINT ai_usage_limits_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: ai_usage_limits ai_usage_limits_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_limits
    ADD CONSTRAINT ai_usage_limits_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: ai_usage_limits ai_usage_limits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_limits
    ADD CONSTRAINT ai_usage_limits_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: ai_usage_limits ai_usage_limits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_limits
    ADD CONSTRAINT ai_usage_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: brain_embeddings brain_embeddings_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_embeddings
    ADD CONSTRAINT brain_embeddings_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brain_embeddings brain_embeddings_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_embeddings
    ADD CONSTRAINT brain_embeddings_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.brain_events(id) ON DELETE CASCADE;

--
-- Name: brain_events brain_events_new_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_events
    ADD CONSTRAINT brain_events_new_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brain_insights brain_insights_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_insights
    ADD CONSTRAINT brain_insights_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brain_insights brain_insights_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_insights
    ADD CONSTRAINT brain_insights_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brain_learning_queue brain_learning_queue_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_learning_queue
    ADD CONSTRAINT brain_learning_queue_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.brain_events(id) ON DELETE CASCADE;

--
-- Name: brain_memory brain_memory_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_memory
    ADD CONSTRAINT brain_memory_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brain_memory brain_memory_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_memory
    ADD CONSTRAINT brain_memory_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brain_memory_versions brain_memory_versions_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_memory_versions
    ADD CONSTRAINT brain_memory_versions_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.brain_memory(id) ON DELETE CASCADE;

--
-- Name: brain_metrics_snapshots brain_metrics_snapshots_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_metrics_snapshots
    ADD CONSTRAINT brain_metrics_snapshots_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brain_recommendations brain_recommendations_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_recommendations
    ADD CONSTRAINT brain_recommendations_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brain_recommendations brain_recommendations_source_insight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_recommendations
    ADD CONSTRAINT brain_recommendations_source_insight_id_fkey FOREIGN KEY (source_insight_id) REFERENCES public.brain_insights(id) ON DELETE SET NULL;

--
-- Name: brain_relationships brain_relationships_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_relationships
    ADD CONSTRAINT brain_relationships_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brain_relationships brain_relationships_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brain_relationships
    ADD CONSTRAINT brain_relationships_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_ai_content brand_ai_content_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_content
    ADD CONSTRAINT brand_ai_content_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_ai_content brand_ai_content_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_content
    ADD CONSTRAINT brand_ai_content_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_ai_content brand_ai_content_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_content
    ADD CONSTRAINT brand_ai_content_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_ai_content brand_ai_content_pauta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_content
    ADD CONSTRAINT brand_ai_content_pauta_id_fkey FOREIGN KEY (pauta_id) REFERENCES public.brand_pautas(id) ON DELETE SET NULL;

--
-- Name: brand_ai_content brand_ai_content_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_content
    ADD CONSTRAINT brand_ai_content_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE SET NULL;

--
-- Name: brand_ai_usage brand_ai_usage_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_usage
    ADD CONSTRAINT brand_ai_usage_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_ai_usage brand_ai_usage_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_usage
    ADD CONSTRAINT brand_ai_usage_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_ai_usage brand_ai_usage_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_usage
    ADD CONSTRAINT brand_ai_usage_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

--
-- Name: brand_ai_versions brand_ai_versions_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_versions
    ADD CONSTRAINT brand_ai_versions_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_ai_versions brand_ai_versions_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_versions
    ADD CONSTRAINT brand_ai_versions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_ai_versions brand_ai_versions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_ai_versions
    ADD CONSTRAINT brand_ai_versions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_api_credentials brand_api_credentials_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_api_credentials
    ADD CONSTRAINT brand_api_credentials_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_briefing_proposals brand_briefing_proposals_base_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_proposals
    ADD CONSTRAINT brand_briefing_proposals_base_version_id_fkey FOREIGN KEY (base_version_id) REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL;

--
-- Name: brand_briefing_proposals brand_briefing_proposals_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_proposals
    ADD CONSTRAINT brand_briefing_proposals_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_briefing_proposals brand_briefing_proposals_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_proposals
    ADD CONSTRAINT brand_briefing_proposals_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_briefing_proposals brand_briefing_proposals_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_proposals
    ADD CONSTRAINT brand_briefing_proposals_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.brand_briefing_requests(id) ON DELETE CASCADE;

--
-- Name: brand_briefing_requests brand_briefing_requests_base_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_requests
    ADD CONSTRAINT brand_briefing_requests_base_version_id_fkey FOREIGN KEY (base_version_id) REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL;

--
-- Name: brand_briefing_requests brand_briefing_requests_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_requests
    ADD CONSTRAINT brand_briefing_requests_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_briefing_requests brand_briefing_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_requests
    ADD CONSTRAINT brand_briefing_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_briefing_requests brand_briefing_requests_promoted_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_requests
    ADD CONSTRAINT brand_briefing_requests_promoted_version_id_fkey FOREIGN KEY (promoted_version_id) REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL;

--
-- Name: brand_briefing_reviews brand_briefing_reviews_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_reviews
    ADD CONSTRAINT brand_briefing_reviews_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.brand_briefing_proposals(id) ON DELETE SET NULL;

--
-- Name: brand_briefing_reviews brand_briefing_reviews_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_reviews
    ADD CONSTRAINT brand_briefing_reviews_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.brand_briefing_requests(id) ON DELETE CASCADE;

--
-- Name: brand_briefing_reviews brand_briefing_reviews_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_reviews
    ADD CONSTRAINT brand_briefing_reviews_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.brand_briefing_versions(id) ON DELETE SET NULL;

--
-- Name: brand_briefing_versions brand_briefing_versions_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_versions
    ADD CONSTRAINT brand_briefing_versions_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_briefing_versions brand_briefing_versions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefing_versions
    ADD CONSTRAINT brand_briefing_versions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_briefings brand_briefings_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefings
    ADD CONSTRAINT brand_briefings_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_briefings brand_briefings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefings
    ADD CONSTRAINT brand_briefings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_briefings brand_briefings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_briefings
    ADD CONSTRAINT brand_briefings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_cohorts brand_cohorts_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_cohorts
    ADD CONSTRAINT brand_cohorts_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_cohorts brand_cohorts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_cohorts
    ADD CONSTRAINT brand_cohorts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_cohorts brand_cohorts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_cohorts
    ADD CONSTRAINT brand_cohorts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_competitors brand_competitors_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_competitors
    ADD CONSTRAINT brand_competitors_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_competitors brand_competitors_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_competitors
    ADD CONSTRAINT brand_competitors_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_competitors brand_competitors_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_competitors
    ADD CONSTRAINT brand_competitors_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_connections brand_connections_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_connections
    ADD CONSTRAINT brand_connections_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_features brand_features_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_features
    ADD CONSTRAINT brand_features_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_features brand_features_enabled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_features
    ADD CONSTRAINT brand_features_enabled_by_fkey FOREIGN KEY (enabled_by) REFERENCES auth.users(id);

--
-- Name: brand_features brand_features_feature_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_features
    ADD CONSTRAINT brand_features_feature_key_fkey FOREIGN KEY (feature_key) REFERENCES public.feature_catalog(key) ON UPDATE CASCADE;

--
-- Name: brand_invites brand_invites_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_invites
    ADD CONSTRAINT brand_invites_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_journey_stage_templates brand_journey_stage_templates_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_journey_stage_templates
    ADD CONSTRAINT brand_journey_stage_templates_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_journey_stage_templates brand_journey_stage_templates_project_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_journey_stage_templates
    ADD CONSTRAINT brand_journey_stage_templates_project_template_id_fkey FOREIGN KEY (project_template_id) REFERENCES public.project_templates(id) ON DELETE CASCADE;

--
-- Name: brand_media_assets brand_media_assets_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_media_assets
    ADD CONSTRAINT brand_media_assets_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_media_assets brand_media_assets_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_media_assets
    ADD CONSTRAINT brand_media_assets_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_members brand_members_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_members
    ADD CONSTRAINT brand_members_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_members brand_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_members
    ADD CONSTRAINT brand_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: brand_pautas brand_pautas_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_pautas
    ADD CONSTRAINT brand_pautas_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_pautas brand_pautas_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_pautas
    ADD CONSTRAINT brand_pautas_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_pautas brand_pautas_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_pautas
    ADD CONSTRAINT brand_pautas_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_personas brand_personas_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_personas
    ADD CONSTRAINT brand_personas_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_personas brand_personas_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_personas
    ADD CONSTRAINT brand_personas_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_personas brand_personas_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_personas
    ADD CONSTRAINT brand_personas_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_swot brand_swot_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_swot
    ADD CONSTRAINT brand_swot_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_swot brand_swot_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_swot
    ADD CONSTRAINT brand_swot_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_swot brand_swot_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_swot
    ADD CONSTRAINT brand_swot_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brand_voice_cards brand_voice_cards_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_voice_cards
    ADD CONSTRAINT brand_voice_cards_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: brand_voice_cards brand_voice_cards_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_voice_cards
    ADD CONSTRAINT brand_voice_cards_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: brand_voice_cards brand_voice_cards_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_voice_cards
    ADD CONSTRAINT brand_voice_cards_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: brands brands_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

--
-- Name: calendar_events calendar_events_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: calendar_events calendar_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: calendar_events calendar_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: card_approval_events card_approval_events_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_events
    ADD CONSTRAINT card_approval_events_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: card_approval_events card_approval_events_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_events
    ADD CONSTRAINT card_approval_events_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

--
-- Name: card_approval_events card_approval_events_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_events
    ADD CONSTRAINT card_approval_events_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.card_approval_tokens(id) ON DELETE SET NULL;

--
-- Name: card_approval_tokens card_approval_tokens_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_tokens
    ADD CONSTRAINT card_approval_tokens_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: card_approval_tokens card_approval_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_tokens
    ADD CONSTRAINT card_approval_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

--
-- Name: card_approval_tokens card_approval_tokens_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_approval_tokens
    ADD CONSTRAINT card_approval_tokens_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

--
-- Name: chat_conversations chat_conversations_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;

--
-- Name: chat_conversations chat_conversations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

--
-- Name: chat_conversations chat_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: chat_messages chat_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;

--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: client_briefing_tokens client_briefing_tokens_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_briefing_tokens
    ADD CONSTRAINT client_briefing_tokens_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: client_briefing_tokens client_briefing_tokens_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_briefing_tokens
    ADD CONSTRAINT client_briefing_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: client_briefings client_briefings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_briefings
    ADD CONSTRAINT client_briefings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: client_briefings client_briefings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_briefings
    ADD CONSTRAINT client_briefings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

--
-- Name: client_documents client_documents_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_documents
    ADD CONSTRAINT client_documents_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: client_documents client_documents_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_documents
    ADD CONSTRAINT client_documents_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: client_journey_events client_journey_events_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_journey_events
    ADD CONSTRAINT client_journey_events_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: client_journey_events client_journey_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_journey_events
    ADD CONSTRAINT client_journey_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: client_journey_events client_journey_events_moved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_journey_events
    ADD CONSTRAINT client_journey_events_moved_by_fkey FOREIGN KEY (moved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: client_journey_events client_journey_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_journey_events
    ADD CONSTRAINT client_journey_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

--
-- Name: client_members client_members_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_members
    ADD CONSTRAINT client_members_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: client_members client_members_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_members
    ADD CONSTRAINT client_members_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: client_social_accounts client_social_accounts_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: client_social_accounts client_social_accounts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: client_social_accounts client_social_accounts_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.social_connections(id) ON DELETE CASCADE;

--
-- Name: client_social_accounts client_social_accounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

--
-- Name: clients clients_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: clients clients_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: content_pipeline_stages content_pipeline_stages_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pipeline_stages
    ADD CONSTRAINT content_pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.content_pipelines(id) ON DELETE CASCADE;

--
-- Name: content_pipelines content_pipelines_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pipelines
    ADD CONSTRAINT content_pipelines_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: content_pipelines content_pipelines_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pipelines
    ADD CONSTRAINT content_pipelines_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: evolution_events evolution_events_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_events
    ADD CONSTRAINT evolution_events_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: evolution_events evolution_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_events
    ADD CONSTRAINT evolution_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

--
-- Name: evolution_events evolution_events_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_events
    ADD CONSTRAINT evolution_events_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.evolution_instances(id) ON DELETE CASCADE;

--
-- Name: evolution_instances evolution_instances_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_instances
    ADD CONSTRAINT evolution_instances_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: evolution_instances evolution_instances_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_instances
    ADD CONSTRAINT evolution_instances_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

--
-- Name: media_plan_items media_plan_items_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_plan_items
    ADD CONSTRAINT media_plan_items_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.media_plans(id) ON DELETE CASCADE;

--
-- Name: media_plans media_plans_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_plans
    ADD CONSTRAINT media_plans_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: media_plans media_plans_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_plans
    ADD CONSTRAINT media_plans_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: message_logs message_logs_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_logs
    ADD CONSTRAINT message_logs_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: message_logs message_logs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_logs
    ADD CONSTRAINT message_logs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

--
-- Name: message_templates message_templates_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: meta_oauth_sessions meta_oauth_sessions_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_oauth_sessions
    ADD CONSTRAINT meta_oauth_sessions_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: meta_oauth_sessions meta_oauth_sessions_portfolio_source_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_oauth_sessions
    ADD CONSTRAINT meta_oauth_sessions_portfolio_source_session_id_fkey FOREIGN KEY (portfolio_source_session_id) REFERENCES public.meta_oauth_sessions(id) ON DELETE SET NULL;

--
-- Name: monthly_plan_tokens monthly_plan_tokens_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plan_tokens
    ADD CONSTRAINT monthly_plan_tokens_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: monthly_plan_tokens monthly_plan_tokens_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plan_tokens
    ADD CONSTRAINT monthly_plan_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: monthly_plan_tokens monthly_plan_tokens_monthly_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plan_tokens
    ADD CONSTRAINT monthly_plan_tokens_monthly_plan_id_fkey FOREIGN KEY (monthly_plan_id) REFERENCES public.monthly_plans(id) ON DELETE CASCADE;

--
-- Name: monthly_plan_topics monthly_plan_topics_monthly_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plan_topics
    ADD CONSTRAINT monthly_plan_topics_monthly_plan_id_fkey FOREIGN KEY (monthly_plan_id) REFERENCES public.monthly_plans(id) ON DELETE CASCADE;

--
-- Name: monthly_plans monthly_plans_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plans
    ADD CONSTRAINT monthly_plans_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: monthly_plans monthly_plans_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plans
    ADD CONSTRAINT monthly_plans_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: monthly_plans monthly_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plans
    ADD CONSTRAINT monthly_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: monthly_plans monthly_plans_input_briefing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plans
    ADD CONSTRAINT monthly_plans_input_briefing_id_fkey FOREIGN KEY (input_briefing_id) REFERENCES public.brand_briefings(id) ON DELETE SET NULL;

--
-- Name: monthly_plans monthly_plans_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_plans
    ADD CONSTRAINT monthly_plans_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

--
-- Name: notifications notifications_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: plan_overage_requests plan_overage_requests_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_overage_requests
    ADD CONSTRAINT plan_overage_requests_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: plan_overage_requests plan_overage_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_overage_requests
    ADD CONSTRAINT plan_overage_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: portal_tokens portal_tokens_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_tokens
    ADD CONSTRAINT portal_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: portal_tokens portal_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_tokens
    ADD CONSTRAINT portal_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

--
-- Name: post_approvals post_approvals_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_approvals
    ADD CONSTRAINT post_approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id);

--
-- Name: post_approvals post_approvals_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_approvals
    ADD CONSTRAINT post_approvals_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

--
-- Name: post_placements post_placements_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_placements
    ADD CONSTRAINT post_placements_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: post_placements post_placements_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_placements
    ADD CONSTRAINT post_placements_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: post_placements post_placements_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_placements
    ADD CONSTRAINT post_placements_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.social_connections(id) ON DELETE SET NULL;

--
-- Name: post_placements post_placements_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_placements
    ADD CONSTRAINT post_placements_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

--
-- Name: posts posts_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id);

--
-- Name: posts posts_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: posts posts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: posts posts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

--
-- Name: posts posts_monthly_plan_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_monthly_plan_topic_id_fkey FOREIGN KEY (monthly_plan_topic_id) REFERENCES public.monthly_plan_topics(id) ON DELETE SET NULL;

--
-- Name: posts posts_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.content_pipelines(id) ON DELETE SET NULL;

--
-- Name: posts posts_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

--
-- Name: posts posts_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.content_pipeline_stages(id) ON DELETE SET NULL;

--
-- Name: project_jobs project_jobs_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_jobs
    ADD CONSTRAINT project_jobs_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: project_jobs project_jobs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_jobs
    ADD CONSTRAINT project_jobs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

--
-- Name: project_template_jobs project_template_jobs_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_template_jobs
    ADD CONSTRAINT project_template_jobs_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.project_templates(id) ON DELETE CASCADE;

--
-- Name: project_template_tasks project_template_tasks_template_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_template_tasks
    ADD CONSTRAINT project_template_tasks_template_job_id_fkey FOREIGN KEY (template_job_id) REFERENCES public.project_template_jobs(id) ON DELETE CASCADE;

--
-- Name: project_templates project_templates_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_templates
    ADD CONSTRAINT project_templates_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: projects projects_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: projects projects_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: projects projects_monthly_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_monthly_plan_id_fkey FOREIGN KEY (monthly_plan_id) REFERENCES public.monthly_plans(id) ON DELETE SET NULL;

--
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);

--
-- Name: sla_rules sla_rules_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_rules
    ADD CONSTRAINT sla_rules_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: sla_rules sla_rules_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_rules
    ADD CONSTRAINT sla_rules_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

--
-- Name: social_connections social_connections_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_connections
    ADD CONSTRAINT social_connections_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: social_connections social_connections_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_connections
    ADD CONSTRAINT social_connections_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: social_connections social_connections_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_connections
    ADD CONSTRAINT social_connections_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: social_posts social_posts_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: social_posts social_posts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

--
-- Name: social_posts social_posts_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.social_connections(id) ON DELETE CASCADE;

--
-- Name: social_posts social_posts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: task_comments task_comments_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: task_comments task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

--
-- Name: task_subtasks task_subtasks_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT task_subtasks_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: task_subtasks task_subtasks_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT task_subtasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

--
-- Name: task_time_entries task_time_entries_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_time_entries
    ADD CONSTRAINT task_time_entries_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: task_time_entries task_time_entries_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_time_entries
    ADD CONSTRAINT task_time_entries_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id);

--
-- Name: tasks tasks_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

--
-- Name: tasks tasks_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.project_jobs(id) ON DELETE SET NULL;

--
-- Name: tasks tasks_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

--
-- Name: user_profiles user_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: whatsapp_recipients whatsapp_recipients_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_recipients
    ADD CONSTRAINT whatsapp_recipients_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

--
-- Name: whatsapp_recipients whatsapp_recipients_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_recipients
    ADD CONSTRAINT whatsapp_recipients_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


-- ============================ INDEXES (203) ============================

--
-- Name: agent_prompt_overrides_brand_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_prompt_overrides_brand_agent_idx ON public.agent_prompt_overrides USING btree (brand_id, agent_id);

--
-- Name: ai_jobs_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_jobs_brand_idx ON public.ai_jobs USING btree (brand_id, created_at DESC);

--
-- Name: ai_jobs_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_jobs_user_status_idx ON public.ai_jobs USING btree (user_id, status, created_at DESC);

--
-- Name: ai_model_health_checked_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_model_health_checked_at_idx ON public.ai_model_health USING btree (checked_at DESC);

--
-- Name: ai_model_health_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_model_health_provider_idx ON public.ai_model_health USING btree (provider, checked_at DESC);

--
-- Name: ai_usage_limits_brand_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_usage_limits_brand_unique ON public.ai_usage_limits USING btree (brand_id) WHERE (scope = 'brand'::text);

--
-- Name: ai_usage_limits_client_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_usage_limits_client_unique ON public.ai_usage_limits USING btree (brand_id, client_id) WHERE (scope = 'client'::text);

--
-- Name: ai_usage_limits_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_usage_limits_user_unique ON public.ai_usage_limits USING btree (brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), user_id) WHERE (scope = 'user'::text);

--
-- Name: brain_embeddings_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_embeddings_brand_idx ON public.brain_embeddings USING btree (brand_id);

--
-- Name: brain_embeddings_created_brin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_embeddings_created_brin ON public.brain_embeddings USING brin (created_at);

--
-- Name: brain_embeddings_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_embeddings_event_idx ON public.brain_embeddings USING btree (event_id);

--
-- Name: brain_embeddings_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_embeddings_hnsw_idx ON public.brain_embeddings USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64') WHERE (embedding IS NOT NULL);

--
-- Name: brain_events_brand_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_events_brand_created_idx ON public.brain_events USING btree (brand_id, created_at DESC);

--
-- Name: brain_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_events_type_idx ON public.brain_events USING btree (event_type);

--
-- Name: brain_events_unprocessed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_events_unprocessed_idx ON public.brain_events USING btree (created_at) WHERE (processed_at IS NULL);

--
-- Name: brain_insights_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_insights_brand_idx ON public.brain_insights USING btree (brand_id, created_at DESC);

--
-- Name: brain_memory_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_memory_expires_idx ON public.brain_memory USING btree (expires_at) WHERE (expires_at IS NOT NULL);

--
-- Name: brain_memory_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_memory_subject_idx ON public.brain_memory USING btree (brand_id, subject_type, subject_id);

--
-- Name: brain_metrics_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_metrics_brand_idx ON public.brain_metrics_snapshots USING btree (brand_id, period_end DESC);

--
-- Name: brain_reasoning_logs_brand_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_reasoning_logs_brand_created_idx ON public.brain_reasoning_logs USING btree (brand_id, created_at DESC);

--
-- Name: brain_reasoning_logs_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_reasoning_logs_user_created_idx ON public.brain_reasoning_logs USING btree (user_id, created_at DESC);

--
-- Name: brain_recs_brand_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_recs_brand_status_idx ON public.brain_recommendations USING btree (brand_id, status, priority DESC);

--
-- Name: brain_recs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_recs_user_idx ON public.brain_recommendations USING btree (target_user_id, status);

--
-- Name: brain_rel_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_rel_from_idx ON public.brain_relationships USING btree (brand_id, from_type, from_id);

--
-- Name: brain_rel_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_rel_to_idx ON public.brain_relationships USING btree (brand_id, to_type, to_id);

--
-- Name: brain_relationships_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_relationships_from_idx ON public.brain_relationships USING btree (brand_id, from_type, from_id);

--
-- Name: brain_relationships_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_relationships_to_idx ON public.brain_relationships USING btree (brand_id, to_type, to_id);

--
-- Name: brain_relationships_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brain_relationships_type_idx ON public.brain_relationships USING btree (brand_id, relationship_type);

--
-- Name: brain_relationships_unique_edge; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX brain_relationships_unique_edge ON public.brain_relationships USING btree (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), from_type, from_id, to_type, to_id, relationship_type);

--
-- Name: brain_stats_mv_brand_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX brain_stats_mv_brand_uniq ON public.brain_stats_mv USING btree (brand_id);

--
-- Name: brand_ai_usage_brand_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_ai_usage_brand_actor_created_idx ON public.brand_ai_usage USING btree (brand_id, actor_id, created_at DESC);

--
-- Name: brand_ai_usage_brand_client_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_ai_usage_brand_client_created_idx ON public.brand_ai_usage USING btree (brand_id, client_id, created_at DESC);

--
-- Name: brand_ai_usage_brand_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_ai_usage_brand_created_idx ON public.brand_ai_usage USING btree (brand_id, created_at DESC);

--
-- Name: brand_briefing_proposals_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_briefing_proposals_request_idx ON public.brand_briefing_proposals USING btree (request_id, created_at DESC);

--
-- Name: brand_briefing_proposals_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_briefing_proposals_scope_idx ON public.brand_briefing_proposals USING btree (brand_id, client_id, created_at DESC);

--
-- Name: brand_briefing_requests_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_briefing_requests_scope_idx ON public.brand_briefing_requests USING btree (brand_id, client_id, requested_at DESC);

--
-- Name: brand_briefing_reviews_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_briefing_reviews_request_idx ON public.brand_briefing_reviews USING btree (request_id, created_at DESC);

--
-- Name: brand_briefing_reviews_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_briefing_reviews_scope_idx ON public.brand_briefing_reviews USING btree (brand_id, client_id, created_at DESC);

--
-- Name: brand_features_brand_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_features_brand_id_idx ON public.brand_features USING btree (brand_id);

--
-- Name: brand_invites_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_invites_brand_idx ON public.brand_invites USING btree (brand_id);

--
-- Name: brand_invites_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brand_invites_email_idx ON public.brand_invites USING btree (lower(email));

--
-- Name: brands_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX brands_is_active_idx ON public.brands USING btree (is_active);

--
-- Name: calendar_events_brand_starts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_brand_starts_idx ON public.calendar_events USING btree (brand_id, starts_at);

--
-- Name: calendar_events_global_starts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_global_starts_idx ON public.calendar_events USING btree (starts_at) WHERE (is_global = true);

--
-- Name: card_approval_events_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_approval_events_post_idx ON public.card_approval_events USING btree (post_id, created_at DESC);

--
-- Name: card_approval_tokens_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_approval_tokens_post_idx ON public.card_approval_tokens USING btree (post_id);

--
-- Name: chat_conversations_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_conversations_user_idx ON public.chat_conversations USING btree (user_id, last_message_at DESC);

--
-- Name: chat_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_conversation_idx ON public.chat_messages USING btree (conversation_id, created_at);

--
-- Name: client_briefing_tokens_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_briefing_tokens_brand_idx ON public.client_briefing_tokens USING btree (brand_id);

--
-- Name: client_briefing_tokens_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_briefing_tokens_client_idx ON public.client_briefing_tokens USING btree (client_id);

--
-- Name: client_documents_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_documents_client_idx ON public.client_documents USING btree (client_id, created_at DESC);

--
-- Name: client_documents_visible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_documents_visible_idx ON public.client_documents USING btree (client_id, visible_to_client);

--
-- Name: client_members_brand_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_members_brand_id_idx ON public.client_members USING btree (brand_id);

--
-- Name: client_members_client_user_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_members_client_user_key ON public.client_members USING btree (client_id, user_id);

--
-- Name: client_members_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_members_portal_idx ON public.client_members USING btree (user_id) WHERE (role = 'portal_client'::text);

--
-- Name: client_members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_members_user_id_idx ON public.client_members USING btree (user_id);

--
-- Name: client_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_members_user_idx ON public.client_members USING btree (user_id);

--
-- Name: client_social_accounts_client_connection_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_social_accounts_client_connection_key ON public.client_social_accounts USING btree (client_id, connection_id);

--
-- Name: client_social_accounts_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_social_accounts_connection_idx ON public.client_social_accounts USING btree (connection_id);

--
-- Name: clients_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_is_active_idx ON public.clients USING btree (is_active);

--
-- Name: clients_owner_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_owner_user_id_idx ON public.clients USING btree (owner_user_id);

--
-- Name: evolution_events_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evolution_events_brand_idx ON public.evolution_events USING btree (brand_id, received_at DESC);

--
-- Name: evolution_events_dedupe_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX evolution_events_dedupe_key ON public.evolution_events USING btree (instance_id, event_type, provider_event_id) WHERE (provider_event_id IS NOT NULL);

--
-- Name: evolution_events_instance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evolution_events_instance_idx ON public.evolution_events USING btree (instance_id, received_at DESC);

--
-- Name: evolution_instances_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evolution_instances_brand_idx ON public.evolution_instances USING btree (brand_id);

--
-- Name: evolution_instances_brand_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX evolution_instances_brand_name_key ON public.evolution_instances USING btree (brand_id, lower(instance_name));

--
-- Name: evolution_instances_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evolution_instances_client_idx ON public.evolution_instances USING btree (client_id);

--
-- Name: evolution_instances_webhook_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX evolution_instances_webhook_token_key ON public.evolution_instances USING btree (webhook_token) WHERE (webhook_token IS NOT NULL);

--
-- Name: idx_activity_events_brand_client_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_events_brand_client_created ON public.activity_events USING btree (brand_id, client_id, created_at DESC);

--
-- Name: idx_activity_events_brand_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_events_brand_created ON public.activity_events USING btree (brand_id, created_at DESC);

--
-- Name: idx_activity_events_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_events_client_id ON public.activity_events USING btree (client_id);

--
-- Name: idx_ai_jobs_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_jobs_client_id ON public.ai_jobs USING btree (client_id);

--
-- Name: idx_brain_insights_brand_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_insights_brand_expires ON public.brain_insights USING btree (brand_id, expires_at);

--
-- Name: idx_brain_insights_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_insights_scope ON public.brain_insights USING btree (brand_id, client_id, created_at DESC);

--
-- Name: idx_brain_learning_queue_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_learning_queue_brand ON public.brain_learning_queue USING btree (brand_id);

--
-- Name: idx_brain_learning_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_learning_queue_status ON public.brain_learning_queue USING btree (status, enqueued_at) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));

--
-- Name: idx_brain_memory_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_brand ON public.brain_memory USING btree (brand_id);

--
-- Name: idx_brain_memory_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_category ON public.brain_memory USING btree (category);

--
-- Name: idx_brain_memory_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_client_id ON public.brain_memory USING btree (client_id);

--
-- Name: idx_brain_memory_confidence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_confidence ON public.brain_memory USING btree (confidence DESC);

--
-- Name: idx_brain_memory_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_entity ON public.brain_memory USING btree (entity_type, entity_id);

--
-- Name: idx_brain_memory_last_accessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_last_accessed ON public.brain_memory USING btree (last_accessed_at DESC NULLS LAST);

--
-- Name: idx_brain_memory_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_origin ON public.brain_memory USING btree (origin);

--
-- Name: idx_brain_memory_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_scope ON public.brain_memory USING btree (brand_id, client_id, status, category);

--
-- Name: idx_brain_memory_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_status ON public.brain_memory USING btree (status);

--
-- Name: idx_brain_memory_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_tags ON public.brain_memory USING gin (tags);

--
-- Name: idx_brain_memory_versions_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_versions_brand ON public.brain_memory_versions USING btree (brand_id, created_at DESC);

--
-- Name: idx_brain_memory_versions_memory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_memory_versions_memory ON public.brain_memory_versions USING btree (memory_id, version DESC);

--
-- Name: idx_brain_recs_brand_status_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_recs_brand_status_active ON public.brain_recommendations USING btree (brand_id, status) WHERE (status = 'active'::text);

--
-- Name: idx_brain_relationships_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_relationships_scope ON public.brain_relationships USING btree (brand_id, client_id);

--
-- Name: idx_brain_worker_runs_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brain_worker_runs_recent ON public.brain_worker_runs USING btree (job_name, started_at DESC);

--
-- Name: idx_brand_ai_content_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_ai_content_brand_id ON public.brand_ai_content USING btree (brand_id);

--
-- Name: idx_brand_ai_content_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_ai_content_client ON public.brand_ai_content USING btree (client_id);

--
-- Name: idx_brand_ai_usage_brand_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_ai_usage_brand_date ON public.brand_ai_usage USING btree (brand_id, created_at DESC);

--
-- Name: idx_brand_ai_versions_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_ai_versions_client ON public.brand_ai_versions USING btree (client_id);

--
-- Name: idx_brand_ai_versions_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_ai_versions_entity ON public.brand_ai_versions USING btree (entity_type, entity_id);

--
-- Name: idx_brand_briefing_versions_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_briefing_versions_client ON public.brand_briefing_versions USING btree (client_id, created_at DESC);

--
-- Name: idx_brand_briefings_brand_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_briefings_brand_client ON public.brand_briefings USING btree (brand_id, client_id);

--
-- Name: idx_brand_briefings_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_briefings_client ON public.brand_briefings USING btree (client_id);

--
-- Name: idx_brand_cohorts_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_cohorts_client ON public.brand_cohorts USING btree (client_id);

--
-- Name: idx_brand_competitors_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_competitors_client ON public.brand_competitors USING btree (client_id);

--
-- Name: idx_brand_media_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_media_brand ON public.brand_media_assets USING btree (brand_id, created_at DESC);

--
-- Name: idx_brand_media_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_media_client ON public.brand_media_assets USING btree (brand_id, client_id, created_at DESC);

--
-- Name: idx_brand_media_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_media_kind ON public.brand_media_assets USING btree (brand_id, kind);

--
-- Name: idx_brand_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_members_user ON public.brand_members USING btree (user_id);

--
-- Name: idx_brand_pautas_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_pautas_client ON public.brand_pautas USING btree (client_id);

--
-- Name: idx_brand_personas_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_personas_client ON public.brand_personas USING btree (client_id);

--
-- Name: idx_brand_swot_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_swot_client ON public.brand_swot USING btree (client_id);

--
-- Name: idx_brand_voice_cards_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brand_voice_cards_client ON public.brand_voice_cards USING btree (client_id);

--
-- Name: idx_calendar_events_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_client_id ON public.calendar_events USING btree (client_id);

--
-- Name: idx_client_documents_brand_client_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_documents_brand_client_created ON public.client_documents USING btree (brand_id, client_id, created_at DESC);

--
-- Name: idx_client_journey_events_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_journey_events_brand ON public.client_journey_events USING btree (brand_id, created_at DESC);

--
-- Name: idx_client_journey_events_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_journey_events_client ON public.client_journey_events USING btree (client_id, created_at DESC);

--
-- Name: idx_client_members_user_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_members_user_role ON public.client_members USING btree (user_id, role);

--
-- Name: idx_client_social_accounts_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_social_accounts_brand_id ON public.client_social_accounts USING btree (brand_id);

--
-- Name: idx_client_social_accounts_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_social_accounts_client ON public.client_social_accounts USING btree (client_id);

--
-- Name: idx_client_social_accounts_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_social_accounts_connection ON public.client_social_accounts USING btree (connection_id);

--
-- Name: idx_meta_compliance_events_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_compliance_events_code ON public.meta_compliance_events USING btree (confirmation_code);

--
-- Name: idx_meta_compliance_events_meta_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_compliance_events_meta_user ON public.meta_compliance_events USING btree (meta_user_id);

--
-- Name: idx_meta_oauth_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_oauth_sessions_expires ON public.meta_oauth_sessions USING btree (expires_at);

--
-- Name: idx_meta_oauth_sessions_rate_limit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_oauth_sessions_rate_limit ON public.meta_oauth_sessions USING btree (brand_id, meta_user_id, portfolio_rate_limited_until) WHERE (portfolio_rate_limited_until IS NOT NULL);

--
-- Name: idx_meta_oauth_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_oauth_sessions_user ON public.meta_oauth_sessions USING btree (user_id, created_at DESC);

--
-- Name: idx_meta_oauth_sessions_valid_portfolio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_oauth_sessions_valid_portfolio ON public.meta_oauth_sessions USING btree (brand_id, meta_user_id, portfolio_loaded_at DESC) WHERE ((portfolio_loaded_at IS NOT NULL) AND (portfolio_load_status = ANY (ARRAY['loaded'::text, 'empty'::text])) AND (
CASE jsonb_typeof(COALESCE(pages, '[]'::jsonb))
    WHEN 'array'::text THEN jsonb_array_length(COALESCE(pages, '[]'::jsonb))
    WHEN 'object'::text THEN jsonb_array_length(
    CASE
        WHEN (jsonb_typeof((pages -> 'pages'::text)) = 'array'::text) THEN (pages -> 'pages'::text)
        ELSE '[]'::jsonb
    END)
    ELSE 0
END > 0));

--
-- Name: idx_monthly_plan_topics_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_plan_topics_plan ON public.monthly_plan_topics USING btree (monthly_plan_id);

--
-- Name: idx_monthly_plans_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_plans_brand ON public.monthly_plans USING btree (brand_id);

--
-- Name: idx_monthly_plans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_plans_status ON public.monthly_plans USING btree (brand_id, status);

--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);

--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);

--
-- Name: idx_post_placements_brand_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_placements_brand_client ON public.post_placements USING btree (brand_id, client_id);

--
-- Name: idx_post_placements_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_placements_post ON public.post_placements USING btree (post_id);

--
-- Name: idx_post_placements_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_placements_scheduled ON public.post_placements USING btree (scheduled_at);

--
-- Name: idx_posts_brand_client_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_brand_client_stage ON public.posts USING btree (brand_id, client_id, stage);

--
-- Name: idx_posts_brand_stage_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_brand_stage_scheduled ON public.posts USING btree (brand_id, stage, scheduled_at) WHERE (deleted_at IS NULL);

--
-- Name: idx_posts_brand_stage_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_brand_stage_updated ON public.posts USING btree (brand_id, stage, updated_at DESC) WHERE (deleted_at IS NULL);

--
-- Name: idx_posts_monthly_plan_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_monthly_plan_topic ON public.posts USING btree (monthly_plan_topic_id);

--
-- Name: idx_posts_stage_entered_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_stage_entered_at ON public.posts USING btree (stage_id, stage_entered_at) WHERE (deleted_at IS NULL);

--
-- Name: idx_posts_target_connection_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_target_connection_ids ON public.posts USING gin (target_connection_ids);

--
-- Name: idx_projects_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_brand ON public.projects USING btree (brand_id);

--
-- Name: idx_social_connections_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_connections_brand ON public.social_connections USING btree (brand_id);

--
-- Name: idx_social_connections_brand_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_connections_brand_channel ON public.social_connections USING btree (brand_id, channel);

--
-- Name: idx_social_connections_channel_external; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_connections_channel_external ON public.social_connections USING btree (channel, external_id);

--
-- Name: idx_social_connections_client_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_connections_client_channel ON public.social_connections USING btree (client_id, channel) WHERE (client_id IS NOT NULL);

--
-- Name: idx_social_connections_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_connections_provider ON public.social_connections USING btree (brand_id, provider);

--
-- Name: idx_social_posts_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_posts_brand ON public.social_posts USING btree (brand_id);

--
-- Name: idx_social_posts_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_posts_claim ON public.social_posts USING btree (status, scheduled_at) WHERE (status = 'scheduled'::text);

--
-- Name: idx_social_posts_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_posts_connection ON public.social_posts USING btree (connection_id);

--
-- Name: idx_social_posts_status_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_posts_status_scheduled ON public.social_posts USING btree (status, scheduled_at) WHERE (status = ANY (ARRAY['scheduled'::text, 'publishing'::text]));

--
-- Name: idx_tasks_brand_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_brand_archived ON public.tasks USING btree (brand_id, archived_at);

--
-- Name: idx_tasks_brand_client_done; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_brand_client_done ON public.tasks USING btree (brand_id, client_id, done);

--
-- Name: media_plan_items_plan_pos_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_plan_items_plan_pos_idx ON public.media_plan_items USING btree (plan_id, "position");

--
-- Name: media_plans_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_plans_brand_idx ON public.media_plans USING btree (brand_id);

--
-- Name: media_plans_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_plans_client_idx ON public.media_plans USING btree (client_id, created_at DESC);

--
-- Name: message_logs_brand_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_logs_brand_channel_idx ON public.message_logs USING btree (brand_id, channel);

--
-- Name: message_logs_brand_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_logs_brand_client_idx ON public.message_logs USING btree (brand_id, client_id);

--
-- Name: message_logs_brand_sent_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_logs_brand_sent_at_idx ON public.message_logs USING btree (brand_id, sent_at DESC);

--
-- Name: message_logs_brand_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_logs_brand_status_idx ON public.message_logs USING btree (brand_id, status);

--
-- Name: message_logs_client_sent_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_logs_client_sent_at_idx ON public.message_logs USING btree (client_id, sent_at DESC);

--
-- Name: monthly_plan_tokens_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monthly_plan_tokens_plan_idx ON public.monthly_plan_tokens USING btree (monthly_plan_id);

--
-- Name: monthly_plans_brand_client_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monthly_plans_brand_client_created_idx ON public.monthly_plans USING btree (brand_id, client_id, created_at DESC);

--
-- Name: monthly_plans_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monthly_plans_project_id_idx ON public.monthly_plans USING btree (project_id);

--
-- Name: notifications_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_pending_idx ON public.notifications USING btree (user_id, brand_id, created_at DESC) WHERE ((read_at IS NULL) AND (archived_at IS NULL));

--
-- Name: notifications_user_brand_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_brand_created_idx ON public.notifications USING btree (user_id, brand_id, created_at DESC);

--
-- Name: plan_overage_requests_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_overage_requests_lookup_idx ON public.plan_overage_requests USING btree (client_id, channel, period_month, status);

--
-- Name: portal_rate_limit_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_rate_limit_updated_idx ON public.portal_rate_limit USING btree (updated_at);

--
-- Name: portal_tokens_one_active_per_client; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX portal_tokens_one_active_per_client ON public.portal_tokens USING btree (client_id) WHERE (revoked_at IS NULL);

--
-- Name: post_placements_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX post_placements_connection_idx ON public.post_placements USING btree (connection_id) WHERE (connection_id IS NOT NULL);

--
-- Name: post_placements_post_conn_format_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX post_placements_post_conn_format_key ON public.post_placements USING btree (post_id, connection_id, format) WHERE (connection_id IS NOT NULL);

--
-- Name: posts_channels_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_channels_gin ON public.posts USING gin (channels);

--
-- Name: posts_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_deleted_at_idx ON public.posts USING btree (deleted_at) WHERE (deleted_at IS NULL);

--
-- Name: posts_pipeline_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_pipeline_stage_idx ON public.posts USING btree (pipeline_id, stage_id, "position");

--
-- Name: posts_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_priority_idx ON public.posts USING btree (priority);

--
-- Name: posts_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_project_id_idx ON public.posts USING btree (project_id);

--
-- Name: posts_remind_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_remind_at_idx ON public.posts USING btree (remind_at) WHERE (remind_at IS NOT NULL);

--
-- Name: posts_scheduled_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_scheduled_at_idx ON public.posts USING btree (scheduled_at) WHERE ((deleted_at IS NULL) AND (scheduled_at IS NOT NULL));

--
-- Name: posts_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_tags_gin ON public.posts USING gin (tags);

--
-- Name: project_jobs_project_pos_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_jobs_project_pos_idx ON public.project_jobs USING btree (project_id, "position");

--
-- Name: projects_monthly_plan_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX projects_monthly_plan_id_key ON public.projects USING btree (monthly_plan_id) WHERE (monthly_plan_id IS NOT NULL);

--
-- Name: sla_rules_brand_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sla_rules_brand_scope_idx ON public.sla_rules USING btree (brand_id, scope);

--
-- Name: sla_rules_unique_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sla_rules_unique_scope ON public.sla_rules USING btree (brand_id, scope, COALESCE(scope_ref, ''::text), COALESCE((project_id)::text, ''::text));

--
-- Name: social_connections_brand_provider_channel_ext_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX social_connections_brand_provider_channel_ext_key ON public.social_connections USING btree (brand_id, provider, channel, external_id);

--
-- Name: social_connections_ig_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_connections_ig_id_idx ON public.social_connections USING btree (instagram_business_id) WHERE (instagram_business_id IS NOT NULL);

--
-- Name: social_connections_page_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_connections_page_id_idx ON public.social_connections USING btree (page_id) WHERE (page_id IS NOT NULL);

--
-- Name: social_posts_active_dest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX social_posts_active_dest_key ON public.social_posts USING btree (post_id, connection_id, placement) WHERE ((post_id IS NOT NULL) AND (placement <> 'story'::text) AND (status = ANY (ARRAY['scheduled'::text, 'publishing'::text])));

--
-- Name: task_comments_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_comments_task_idx ON public.task_comments USING btree (task_id, created_at DESC);

--
-- Name: task_subtasks_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_subtasks_task_id_idx ON public.task_subtasks USING btree (task_id);

--
-- Name: task_time_entries_one_running_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX task_time_entries_one_running_per_user ON public.task_time_entries USING btree (user_id) WHERE (ended_at IS NULL);

--
-- Name: task_time_entries_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_time_entries_task_idx ON public.task_time_entries USING btree (task_id, started_at DESC);

--
-- Name: tasks_post_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_post_id_idx ON public.tasks USING btree (post_id);

--
-- Name: tasks_post_production_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_post_production_unique ON public.tasks USING btree (post_id) WHERE (post_id IS NOT NULL);

--
-- Name: tasks_project_job_pos_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_project_job_pos_idx ON public.tasks USING btree (project_id, job_id, "position");

--
-- Name: template_jobs_tpl_pos_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX template_jobs_tpl_pos_idx ON public.project_template_jobs USING btree (template_id, "position");

--
-- Name: template_tasks_job_pos_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX template_tasks_job_pos_idx ON public.project_template_tasks USING btree (template_job_id, "position");

--
-- Name: uq_brain_memory_ident; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_brain_memory_ident ON public.brain_memory USING btree (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, entity_id, category, title);

--
-- Name: uq_brain_metrics_snapshots_events_daily; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_brain_metrics_snapshots_events_daily ON public.brain_metrics_snapshots USING btree (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(channel, 'system'::text), metric_name, period_start) WHERE (metric_name ~~ 'events.%'::text);

--
-- Name: uq_client_social_accounts_client_conn; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_client_social_accounts_client_conn ON public.client_social_accounts USING btree (client_id, connection_id);

--
-- Name: uq_client_social_accounts_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_client_social_accounts_connection ON public.client_social_accounts USING btree (connection_id);

--
-- Name: uq_social_conn_brand_provider_external; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_social_conn_brand_provider_external ON public.social_connections USING btree (brand_id, provider, external_id);

--
-- Name: user_profiles_is_super_admin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_profiles_is_super_admin_idx ON public.user_profiles USING btree (is_super_admin) WHERE is_super_admin;

--
-- Name: ux_notifications_unread_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_notifications_unread_dedupe ON public.notifications USING btree (user_id, kind, dedupe_key) WHERE ((read_at IS NULL) AND (dedupe_key IS NOT NULL));

--
-- Name: whatsapp_recipients_brand_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_recipients_brand_client_idx ON public.whatsapp_recipients USING btree (brand_id, client_id) WHERE is_active;

--
-- Name: whatsapp_recipients_unique_destination; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_recipients_unique_destination ON public.whatsapp_recipients USING btree (brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), type, destination) WHERE (destination IS NOT NULL);

--
-- Name: whatsapp_recipients_unique_dynamic; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_recipients_unique_dynamic ON public.whatsapp_recipients USING btree (brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), type) WHERE ((user_id IS NULL) AND (destination IS NULL));

--
-- Name: whatsapp_recipients_unique_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_recipients_unique_user ON public.whatsapp_recipients USING btree (brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), type, user_id) WHERE (user_id IS NOT NULL);


-- ============================ TRIGGERS (96) ============================

--
-- Name: ai_jobs ai_jobs_notify_completed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_jobs_notify_completed AFTER UPDATE OF status ON public.ai_jobs FOR EACH ROW EXECUTE FUNCTION public.notify_ai_job_completed();

--
-- Name: ai_usage_limits ai_usage_limits_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_usage_limits_touch BEFORE UPDATE ON public.ai_usage_limits FOR EACH ROW EXECUTE FUNCTION public.tg_ai_usage_limits_touch();

--
-- Name: client_documents brain_client_docs_evt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_client_docs_evt AFTER INSERT ON public.client_documents FOR EACH ROW EXECUTE FUNCTION public.brain_trg_client_documents();

--
-- Name: clients brain_clients_evt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_clients_evt AFTER INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.brain_trg_clients();

--
-- Name: brain_insights brain_insights_scope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_insights_scope_guard BEFORE INSERT OR UPDATE ON public.brain_insights FOR EACH ROW EXECUTE FUNCTION public.brain_scope_guard();

--
-- Name: brain_memory brain_memory_scope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_memory_scope_guard BEFORE INSERT OR UPDATE ON public.brain_memory FOR EACH ROW EXECUTE FUNCTION public.brain_scope_guard();

--
-- Name: brain_memory brain_memory_snapshot_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_memory_snapshot_trg BEFORE UPDATE ON public.brain_memory FOR EACH ROW EXECUTE FUNCTION public.brain_memory_snapshot();

--
-- Name: brain_memory brain_memory_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_memory_touch BEFORE UPDATE ON public.brain_memory FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();

--
-- Name: post_approvals brain_post_approvals_evt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_post_approvals_evt AFTER INSERT OR UPDATE ON public.post_approvals FOR EACH ROW EXECUTE FUNCTION public.brain_trg_post_approvals();

--
-- Name: posts brain_posts_evt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_posts_evt AFTER INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.brain_trg_posts();

--
-- Name: projects brain_projects_evt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_projects_evt AFTER INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.brain_trg_projects();

--
-- Name: brain_recommendations brain_recs_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_recs_touch BEFORE UPDATE ON public.brain_recommendations FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();

--
-- Name: brain_relationships brain_rel_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_rel_touch BEFORE UPDATE ON public.brain_relationships FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();

--
-- Name: task_comments brain_task_comments_evt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_task_comments_evt AFTER INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.brain_trg_task_comments();

--
-- Name: tasks brain_tasks_evt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brain_tasks_evt AFTER INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.brain_trg_tasks();

--
-- Name: brand_connections brand_connections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brand_connections_updated_at BEFORE UPDATE ON public.brand_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_invites brand_invites_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER brand_invites_updated_at BEFORE UPDATE ON public.brand_invites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: calendar_events calendar_events_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER calendar_events_touch_updated_at BEFORE UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.calendar_events_touch_updated_at();

--
-- Name: client_documents client_documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER client_documents_updated_at BEFORE UPDATE ON public.client_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: evolution_instances evolution_instances_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evolution_instances_touch_updated_at BEFORE UPDATE ON public.evolution_instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: installation installation_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER installation_touch_updated_at BEFORE UPDATE ON public.installation FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: media_plan_items media_plan_items_amount_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER media_plan_items_amount_trg BEFORE INSERT OR UPDATE OF budget_pct, plan_id ON public.media_plan_items FOR EACH ROW EXECUTE FUNCTION public.recalc_media_plan_item_amount();

--
-- Name: media_plan_items media_plan_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER media_plan_items_updated_at BEFORE UPDATE ON public.media_plan_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: media_plans media_plans_budget_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER media_plans_budget_trg AFTER UPDATE OF monthly_budget ON public.media_plans FOR EACH ROW EXECUTE FUNCTION public.recalc_media_plan_items_on_plan();

--
-- Name: media_plans media_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER media_plans_updated_at BEFORE UPDATE ON public.media_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: message_logs message_logs_guard_scope_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER message_logs_guard_scope_trg BEFORE INSERT OR UPDATE ON public.message_logs FOR EACH ROW EXECUTE FUNCTION public.message_logs_guard_scope();

--
-- Name: plan_overage_requests plan_overage_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER plan_overage_requests_updated_at BEFORE UPDATE ON public.plan_overage_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: posts posts_notify_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER posts_notify_approval AFTER UPDATE OF stage ON public.posts FOR EACH ROW EXECUTE FUNCTION public.notify_post_approval_events();

--
-- Name: posts posts_sync_legacy_stage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER posts_sync_legacy_stage BEFORE INSERT OR UPDATE OF stage_id ON public.posts FOR EACH ROW EXECUTE FUNCTION public.posts_sync_legacy_stage();

--
-- Name: content_pipelines protect_default_pipeline; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_default_pipeline BEFORE DELETE ON public.content_pipelines FOR EACH ROW EXECUTE FUNCTION public.protect_pipeline_delete();

--
-- Name: sla_rules sla_rules_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sla_rules_set_updated_at BEFORE UPDATE ON public.sla_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: task_comments task_comments_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_comments_notify AFTER INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.notify_task_mentions();

--
-- Name: task_comments task_comments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_comments_updated_at BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: task_subtasks task_subtasks_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_subtasks_touch BEFORE UPDATE ON public.task_subtasks FOR EACH ROW EXECUTE FUNCTION public.brain_touch_updated_at();

--
-- Name: tasks tasks_notify_assigned; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_notify_assigned AFTER INSERT OR UPDATE OF assignee_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.notify_task_assigned();

--
-- Name: ai_jobs trg_ai_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ai_jobs_updated_at BEFORE UPDATE ON public.ai_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: post_approvals trg_approvals_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_approvals_updated BEFORE UPDATE ON public.post_approvals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brain_events trg_brain_events_enqueue_learning; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brain_events_enqueue_learning AFTER INSERT ON public.brain_events FOR EACH ROW EXECUTE FUNCTION public.enqueue_brain_event_for_learning();

--
-- Name: brain_events trg_brain_events_guard_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brain_events_guard_identity BEFORE INSERT ON public.brain_events FOR EACH ROW EXECUTE FUNCTION public.brain_events_guard_identity();

--
-- Name: brain_learning_queue trg_brain_learning_queue_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brain_learning_queue_updated BEFORE UPDATE ON public.brain_learning_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brain_memory trg_brain_memory_last_observed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brain_memory_last_observed BEFORE INSERT OR UPDATE ON public.brain_memory FOR EACH ROW EXECUTE FUNCTION public.brain_set_last_observed();

--
-- Name: brand_ai_content trg_brand_ai_content_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_ai_content_updated_at BEFORE UPDATE ON public.brand_ai_content FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_api_credentials trg_brand_api_credentials_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_api_credentials_updated_at BEFORE UPDATE ON public.brand_api_credentials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_briefings trg_brand_briefings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_briefings_updated_at BEFORE UPDATE ON public.brand_briefings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_cohorts trg_brand_cohorts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_cohorts_updated_at BEFORE UPDATE ON public.brand_cohorts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_competitors trg_brand_competitors_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_competitors_updated_at BEFORE UPDATE ON public.brand_competitors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_invites trg_brand_invites_normalize_role; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_invites_normalize_role BEFORE INSERT OR UPDATE OF role ON public.brand_invites FOR EACH ROW EXECUTE FUNCTION public.normalize_app_role();

--
-- Name: brand_media_assets trg_brand_media_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_media_updated_at BEFORE UPDATE ON public.brand_media_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_members trg_brand_members_normalize_role; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_members_normalize_role BEFORE INSERT OR UPDATE OF role ON public.brand_members FOR EACH ROW EXECUTE FUNCTION public.normalize_app_role();

--
-- Name: brand_pautas trg_brand_pautas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_pautas_updated_at BEFORE UPDATE ON public.brand_pautas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_personas trg_brand_personas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_personas_updated_at BEFORE UPDATE ON public.brand_personas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_swot trg_brand_swot_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_swot_updated_at BEFORE UPDATE ON public.brand_swot FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_voice_cards trg_brand_voice_cards_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brand_voice_cards_updated_at BEFORE UPDATE ON public.brand_voice_cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brands trg_brands_add_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brands_add_owner AFTER INSERT ON public.brands FOR EACH ROW EXECUTE FUNCTION public.add_brand_owner();

--
-- Name: brands trg_brands_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brands_updated BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: client_briefings trg_briefings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_briefings_updated BEFORE UPDATE ON public.client_briefings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: chat_conversations trg_chat_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_conversations_updated_at BEFORE UPDATE ON public.chat_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: chat_messages trg_chat_messages_bump; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_messages_bump AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.bump_chat_conversation_last_message();

--
-- Name: client_briefing_tokens trg_client_briefing_tokens_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_briefing_tokens_updated BEFORE UPDATE ON public.client_briefing_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: client_members trg_client_members_normalize_role; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_members_normalize_role BEFORE INSERT OR UPDATE OF role ON public.client_members FOR EACH ROW EXECUTE FUNCTION public.normalize_client_member_role();

--
-- Name: clients trg_clients_set_default_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_set_default_owner BEFORE INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public.clients_set_default_owner();

--
-- Name: clients trg_clients_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brands trg_enable_default_brand_features; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enable_default_brand_features AFTER INSERT ON public.brands FOR EACH ROW EXECUTE FUNCTION public.enable_default_brand_features();

--
-- Name: tasks trg_enforce_task_project_client; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_task_project_client BEFORE INSERT OR UPDATE OF project_id, client_id, brand_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_task_project_client();

--
-- Name: user_profiles trg_guard_super_admin_flag; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_super_admin_flag BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_flag();

--
-- Name: user_profiles trg_guard_super_admin_flag_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_super_admin_flag_insert BEFORE INSERT ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_flag();

--
-- Name: monthly_plan_topics trg_monthly_plan_topics_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_monthly_plan_topics_updated_at BEFORE UPDATE ON public.monthly_plan_topics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: monthly_plans trg_monthly_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_monthly_plans_updated_at BEFORE UPDATE ON public.monthly_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: post_placements trg_post_placements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_post_placements_updated_at BEFORE UPDATE ON public.post_placements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: posts trg_posts_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_posts_activity AFTER INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.log_post_activity();

--
-- Name: posts trg_posts_touch_stage_entered_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_posts_touch_stage_entered_at BEFORE INSERT OR UPDATE OF stage_id ON public.posts FOR EACH ROW EXECUTE FUNCTION public.posts_touch_stage_entered_at();

--
-- Name: posts trg_posts_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_posts_updated BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: project_jobs trg_project_jobs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_project_jobs_updated BEFORE UPDATE ON public.project_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: project_templates trg_project_templates_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_project_templates_updated BEFORE UPDATE ON public.project_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: projects trg_projects_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: projects trg_projects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: social_connections trg_social_connections_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_social_connections_touch BEFORE UPDATE ON public.social_connections FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

--
-- Name: social_posts trg_social_posts_sync_publication; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_social_posts_sync_publication AFTER INSERT OR UPDATE OF status ON public.social_posts FOR EACH ROW EXECUTE FUNCTION public.tg_social_posts_sync_publication();

--
-- Name: social_posts trg_social_posts_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_social_posts_touch BEFORE UPDATE ON public.social_posts FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

--
-- Name: brand_journey_stage_templates trg_stage_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stage_templates_updated_at BEFORE UPDATE ON public.brand_journey_stage_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: task_time_entries trg_task_time_entries_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_task_time_entries_updated BEFORE UPDATE ON public.task_time_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: tasks trg_tasks_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_activity AFTER INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

--
-- Name: tasks trg_tasks_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: task_time_entries trg_time_entry_totals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_time_entry_totals AFTER INSERT OR DELETE OR UPDATE ON public.task_time_entries FOR EACH ROW EXECUTE FUNCTION public.trg_time_entry_refresh_totals();

--
-- Name: client_social_accounts trg_validate_client_social_account; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_client_social_account BEFORE INSERT OR UPDATE ON public.client_social_accounts FOR EACH ROW EXECUTE FUNCTION public.validate_client_social_account();

--
-- Name: post_placements trg_validate_placement_connection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_placement_connection BEFORE INSERT OR UPDATE OF connection_id, client_id ON public.post_placements FOR EACH ROW EXECUTE FUNCTION public.validate_placement_connection();

--
-- Name: agent_prompt_overrides update_agent_prompt_overrides_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_agent_prompt_overrides_updated_at BEFORE UPDATE ON public.agent_prompt_overrides FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: agent_prompts update_agent_prompts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_agent_prompts_updated_at BEFORE UPDATE ON public.agent_prompts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: ai_jobs update_ai_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ai_jobs_updated_at BEFORE UPDATE ON public.ai_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: brand_features update_brand_features_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_brand_features_updated_at BEFORE UPDATE ON public.brand_features FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: content_pipeline_stages update_content_pipeline_stages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_content_pipeline_stages_updated_at BEFORE UPDATE ON public.content_pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: content_pipelines update_content_pipelines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_content_pipelines_updated_at BEFORE UPDATE ON public.content_pipelines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: message_templates update_message_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_message_templates_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: monthly_plan_tokens update_monthly_plan_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_monthly_plan_tokens_updated_at BEFORE UPDATE ON public.monthly_plan_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: user_profiles update_user_profiles_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_profiles_modtime BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: whatsapp_recipients whatsapp_recipients_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER whatsapp_recipients_touch_updated_at BEFORE UPDATE ON public.whatsapp_recipients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============================ ROW LEVEL SECURITY (90) ============================

ALTER TABLE ONLY public.brain_events FORCE ROW LEVEL SECURITY;

--
-- Name: activity_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_prompt_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_prompt_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_prompts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_prompts ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_model_catalog_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_model_catalog_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_model_health; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_model_health ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_events ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_learning_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_learning_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_memory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_memory ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_memory_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_memory_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_metrics_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_metrics_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_reasoning_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_reasoning_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_recommendations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_recommendations ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_retention_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_retention_config ENABLE ROW LEVEL SECURITY;

--
-- Name: brain_worker_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brain_worker_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_ai_content; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_ai_content ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_ai_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_ai_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_ai_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_ai_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_api_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_api_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_briefing_proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_briefing_proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_briefing_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_briefing_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_briefing_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_briefing_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_briefing_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_briefing_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_briefings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_briefings ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_cohorts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_cohorts ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_competitors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_competitors ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_features; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_features ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_journey_stage_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_journey_stage_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_media_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_media_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_members ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_pautas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_pautas ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_personas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_personas ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_swot; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_swot ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_voice_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_voice_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: brands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

--
-- Name: card_approval_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_approval_events ENABLE ROW LEVEL SECURITY;

--
-- Name: card_approval_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_approval_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: client_briefing_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_briefing_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: client_briefings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_briefings ENABLE ROW LEVEL SECURITY;

--
-- Name: client_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: client_journey_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_journey_events ENABLE ROW LEVEL SECURITY;

--
-- Name: client_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_members ENABLE ROW LEVEL SECURITY;

--
-- Name: client_social_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_social_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: content_pipeline_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: content_pipelines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_pipelines ENABLE ROW LEVEL SECURITY;

--
-- Name: evolution_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evolution_events ENABLE ROW LEVEL SECURITY;

--
-- Name: evolution_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evolution_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feature_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: installation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.installation ENABLE ROW LEVEL SECURITY;

--
-- Name: media_plan_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.media_plan_items ENABLE ROW LEVEL SECURITY;

--
-- Name: media_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.media_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: message_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: message_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_compliance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta_compliance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_oauth_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta_oauth_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: monthly_plan_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.monthly_plan_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: monthly_plan_topics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.monthly_plan_topics ENABLE ROW LEVEL SECURITY;

--
-- Name: monthly_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.monthly_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_overage_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plan_overage_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_rate_limit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_rate_limit ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: post_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.post_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: post_placements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.post_placements ENABLE ROW LEVEL SECURITY;

--
-- Name: posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

--
-- Name: project_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: project_template_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_template_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: project_template_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_template_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: project_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: sla_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sla_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: social_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: social_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: task_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_subtasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;

--
-- Name: task_time_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_time_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_recipients ENABLE ROW LEVEL SECURITY;


-- ============================ POLICIES (200) ============================

--
-- Name: brand_connections Members can read brand connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read brand connections" ON public.brand_connections FOR SELECT TO authenticated USING (public.is_brand_member(brand_id, auth.uid()));

--
-- Name: brand_connections Members can update brand connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can update brand connections" ON public.brand_connections FOR UPDATE TO authenticated USING (public.is_brand_member(brand_id, auth.uid())) WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

--
-- Name: brand_connections Members can upsert brand connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can upsert brand connections" ON public.brand_connections FOR INSERT TO authenticated WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

--
-- Name: client_members Portal user reads own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal user reads own membership" ON public.client_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) AND (role = 'portal_client'::text)));

--
-- Name: ai_model_health Super admins can view ai model health; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins can view ai model health" ON public.ai_model_health FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (up.is_super_admin = true)))));

--
-- Name: meta_oauth_sessions Users can delete own meta sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own meta sessions" ON public.meta_oauth_sessions FOR DELETE TO authenticated USING ((user_id = auth.uid()));

--
-- Name: meta_oauth_sessions Users can read own meta sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own meta sessions" ON public.meta_oauth_sessions FOR SELECT TO authenticated USING ((user_id = auth.uid()));

--
-- Name: meta_oauth_sessions Users can update own meta sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own meta sessions" ON public.meta_oauth_sessions FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

--
-- Name: user_profiles Users see own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own profile" ON public.user_profiles FOR SELECT TO authenticated USING ((auth.uid() = id));

--
-- Name: user_profiles Users see profiles of shared brand members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see profiles of shared brand members" ON public.user_profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_super_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM (public.brand_members me
     JOIN public.brand_members other ON ((other.brand_id = me.brand_id)))
  WHERE ((me.user_id = auth.uid()) AND me.is_active AND (other.user_id = user_profiles.id) AND other.is_active)))));

--
-- Name: user_profiles Usuários atualizam próprio perfil; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Usuários atualizam próprio perfil" ON public.user_profiles FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));

--
-- Name: content_pipeline_stages admin level delete stages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin level delete stages" ON public.content_pipeline_stages FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.content_pipelines p
  WHERE ((p.id = content_pipeline_stages.pipeline_id) AND public.is_brand_admin_level(p.brand_id, auth.uid())))));

--
-- Name: content_pipeline_stages admin level insert stages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin level insert stages" ON public.content_pipeline_stages FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.content_pipelines p
  WHERE ((p.id = content_pipeline_stages.pipeline_id) AND public.is_brand_admin_level(p.brand_id, auth.uid())))));

--
-- Name: content_pipeline_stages admin level update stages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin level update stages" ON public.content_pipeline_stages FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.content_pipelines p
  WHERE ((p.id = content_pipeline_stages.pipeline_id) AND public.is_brand_admin_level(p.brand_id, auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.content_pipelines p
  WHERE ((p.id = content_pipeline_stages.pipeline_id) AND public.is_brand_admin_level(p.brand_id, auth.uid())))));

--
-- Name: brands admin level updates brand; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin level updates brand" ON public.brands FOR UPDATE TO authenticated USING (public.is_brand_admin_level(id, auth.uid())) WITH CHECK (public.is_brand_admin_level(id, auth.uid()));

--
-- Name: brand_members admins manage non-owner members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage non-owner members" ON public.brand_members TO authenticated USING (((public.app_access_role(auth.uid(), brand_id) = 'admin'::text) AND (role <> 'owner'::public.app_role))) WITH CHECK (((public.app_access_role(auth.uid(), brand_id) = 'admin'::text) AND (role <> 'owner'::public.app_role)));

--
-- Name: agent_prompts agent_prompts_read_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_prompts_read_super_admin ON public.agent_prompts FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

--
-- Name: agent_prompts agent_prompts_update_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_prompts_update_super_admin ON public.agent_prompts FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: brand_ai_usage ai usage in client scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ai usage in client scope read" ON public.brand_ai_usage FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: ai_jobs ai_jobs in client scope insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ai_jobs in client scope insert" ON public.ai_jobs FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_id) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: ai_jobs ai_jobs in client scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ai_jobs in client scope read" ON public.ai_jobs FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: ai_usage_limits ai_usage_limits_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_usage_limits_manage ON public.ai_usage_limits TO authenticated USING (public.can_manage_brand_ai_limits(brand_id, auth.uid())) WITH CHECK (public.can_manage_brand_ai_limits(brand_id, auth.uid()));

--
-- Name: card_approval_events approval events in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "approval events in client scope" ON public.card_approval_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = card_approval_events.post_id) AND public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id)))));

--
-- Name: card_approval_tokens approval tokens in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "approval tokens in client scope" ON public.card_approval_tokens TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = card_approval_tokens.post_id) AND public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = card_approval_tokens.post_id) AND public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id)))));

--
-- Name: post_approvals approvals delete agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "approvals delete agency only" ON public.post_approvals FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = post_approvals.post_id) AND public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id)))));

--
-- Name: post_approvals approvals insert agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "approvals insert agency only" ON public.post_approvals FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = post_approvals.post_id) AND public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id)))));

--
-- Name: post_approvals approvals read scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "approvals read scoped" ON public.post_approvals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = post_approvals.post_id) AND ((public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id)) OR (public.is_portal_client_of(p.client_id, auth.uid()) AND (p.visible_in_portal IS TRUE) AND (p.deleted_at IS NULL)))))));

--
-- Name: post_approvals approvals update agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "approvals update agency only" ON public.post_approvals FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = post_approvals.post_id) AND public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = post_approvals.post_id) AND public.can_access_client(p.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), p.brand_id)))));

--
-- Name: brain_events brain_events_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brain_events_insert ON public.brain_events FOR INSERT TO authenticated WITH CHECK ((public.client_in_scope(client_id, brand_id) AND ((actor_id IS NULL) OR (actor_id = auth.uid())) AND (created_at >= (now() - '00:02:00'::interval)) AND (created_at <= (now() + '00:02:00'::interval))));

--
-- Name: brain_events brain_events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brain_events_select ON public.brain_events FOR SELECT TO authenticated USING ((public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: brain_insights brain_insights select in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brain_insights select in client scope" ON public.brain_insights FOR SELECT TO authenticated USING (((brand_id IS NULL) OR public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: brain_memory brain_memory select in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brain_memory select in client scope" ON public.brain_memory FOR SELECT TO authenticated USING ((public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: brain_memory_versions brain_memory_versions select in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brain_memory_versions select in scope" ON public.brain_memory_versions FOR SELECT TO authenticated USING ((public.is_super_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.brain_memory m
  WHERE ((m.id = brain_memory_versions.memory_id) AND public.client_in_scope(m.client_id, m.brand_id))))));

--
-- Name: brain_metrics_snapshots brain_metrics select admin scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brain_metrics select admin scope" ON public.brain_metrics_snapshots FOR SELECT TO authenticated USING ((public.is_super_admin(auth.uid()) OR ((brand_id IS NOT NULL) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text])))));

--
-- Name: brain_recommendations brain_recommendations select in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brain_recommendations select in client scope" ON public.brain_recommendations FOR SELECT TO authenticated USING ((public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: brain_relationships brain_relationships select in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brain_relationships select in client scope" ON public.brain_relationships FOR SELECT TO authenticated USING ((public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: brain_retention_config brain_retention_config read by any authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brain_retention_config read by any authenticated" ON public.brain_retention_config FOR SELECT TO authenticated USING (true);

--
-- Name: brain_worker_runs brain_worker_runs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brain_worker_runs_read ON public.brain_worker_runs FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

--
-- Name: brand_invites brand admins create invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand admins create invites" ON public.brand_invites FOR INSERT TO authenticated WITH CHECK (public.can_invite_brand_role(brand_id, auth.uid(), role, email));

--
-- Name: brand_invites brand admins delete invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand admins delete invites" ON public.brand_invites FOR DELETE TO authenticated USING (public.is_brand_admin_level(brand_id, auth.uid()));

--
-- Name: brand_invites brand admins read invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand admins read invites" ON public.brand_invites FOR SELECT TO authenticated USING (public.is_brand_admin_level(brand_id, auth.uid()));

--
-- Name: brand_invites brand admins update invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand admins update invites" ON public.brand_invites FOR UPDATE TO authenticated USING (public.is_brand_admin_level(brand_id, auth.uid())) WITH CHECK (public.can_invite_brand_role(brand_id, auth.uid(), role, email));

--
-- Name: brand_ai_content brand members access ai content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members access ai content" ON public.brand_ai_content USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_briefings brand members access briefings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members access briefings" ON public.brand_briefings TO authenticated USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_competitors brand members access competitors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members access competitors" ON public.brand_competitors USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_pautas brand members access pautas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members access pautas" ON public.brand_pautas USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_personas brand members access personas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members access personas" ON public.brand_personas USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_swot brand members access swot; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members access swot" ON public.brand_swot USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_voice_cards brand members access voice cards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members access voice cards" ON public.brand_voice_cards USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_ai_versions brand members insert versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members insert versions" ON public.brand_ai_versions FOR INSERT WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: client_briefing_tokens brand members manage briefing tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members manage briefing tokens" ON public.client_briefing_tokens USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: client_briefings brand members manage briefings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members manage briefings" ON public.client_briefings USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_api_credentials brand members manage credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members manage credentials" ON public.brand_api_credentials TO authenticated USING ((public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()))) WITH CHECK ((public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid())));

--
-- Name: media_plan_items brand members manage media plan items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members manage media plan items" ON public.media_plan_items USING ((EXISTS ( SELECT 1
   FROM public.media_plans mp
  WHERE ((mp.id = media_plan_items.plan_id) AND public.can_access_client(mp.client_id, auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.media_plans mp
  WHERE ((mp.id = media_plan_items.plan_id) AND public.can_access_client(mp.client_id, auth.uid())))));

--
-- Name: media_plans brand members manage media plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members manage media plans" ON public.media_plans USING (public.can_access_client(client_id, auth.uid())) WITH CHECK (public.can_access_client(client_id, auth.uid()));

--
-- Name: post_placements brand members manage placements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members manage placements" ON public.post_placements USING ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = post_placements.post_id) AND public.can_access_client(p.client_id, auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.posts p
  WHERE ((p.id = post_placements.post_id) AND public.can_access_client(p.client_id, auth.uid())))));

--
-- Name: activity_events brand members read activity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members read activity" ON public.activity_events FOR SELECT TO authenticated USING (
CASE
    WHEN (client_id IS NULL) THEN (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text]))
    ELSE public.can_access_client(client_id, auth.uid())
END);

--
-- Name: agent_prompt_overrides brand members read overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members read overrides" ON public.agent_prompt_overrides FOR SELECT TO authenticated USING (public.is_brand_member(brand_id, auth.uid()));

--
-- Name: content_pipeline_stages brand members read stages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members read stages" ON public.content_pipeline_stages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.content_pipelines p
  WHERE ((p.id = content_pipeline_stages.pipeline_id) AND public.is_brand_member(p.brand_id, auth.uid())))));

--
-- Name: message_templates brand members read templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members read templates" ON public.message_templates FOR SELECT TO authenticated USING ((public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid())));

--
-- Name: brand_ai_versions brand members read versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members read versions" ON public.brand_ai_versions FOR SELECT USING (public.can_access_client(client_id, auth.uid()));

--
-- Name: agent_prompt_overrides brand members write overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members write overrides" ON public.agent_prompt_overrides TO authenticated USING (public.is_brand_member(brand_id, auth.uid())) WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

--
-- Name: message_templates brand members write templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "brand members write templates" ON public.message_templates TO authenticated USING ((public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()))) WITH CHECK ((public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid())));

--
-- Name: brand_features brand_features_delete_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brand_features_delete_superadmin ON public.brand_features FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

--
-- Name: brand_features brand_features_insert_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brand_features_insert_superadmin ON public.brand_features FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: brand_features brand_features_select_members_or_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brand_features_select_members_or_superadmin ON public.brand_features FOR SELECT TO authenticated USING ((public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid())));

--
-- Name: brand_features brand_features_update_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY brand_features_update_superadmin ON public.brand_features FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: brand_briefing_versions briefing versions insert staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "briefing versions insert staff" ON public.brand_briefing_versions FOR INSERT TO authenticated WITH CHECK ((public.can_access_client(client_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text]))));

--
-- Name: brand_briefing_versions briefing versions readable in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "briefing versions readable in scope" ON public.brand_briefing_versions FOR SELECT TO authenticated USING (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_briefing_proposals briefing_proposals_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefing_proposals_select_scoped ON public.brand_briefing_proposals FOR SELECT TO authenticated USING (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_briefing_requests briefing_requests_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefing_requests_select_scoped ON public.brand_briefing_requests FOR SELECT TO authenticated USING (public.can_access_client(client_id, auth.uid()));

--
-- Name: brand_briefing_requests briefing_requests_update_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefing_requests_update_staff ON public.brand_briefing_requests FOR UPDATE TO authenticated USING ((public.can_access_client(client_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text])))) WITH CHECK ((public.can_access_client(client_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text]))));

--
-- Name: brand_briefing_requests briefing_requests_write_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefing_requests_write_staff ON public.brand_briefing_requests FOR INSERT TO authenticated WITH CHECK ((public.can_access_client(client_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text]))));

--
-- Name: brand_briefing_reviews briefing_reviews_insert_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefing_reviews_insert_staff ON public.brand_briefing_reviews FOR INSERT TO authenticated WITH CHECK ((public.can_access_client(client_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text]))));

--
-- Name: brand_briefing_reviews briefing_reviews_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefing_reviews_select_scoped ON public.brand_briefing_reviews FOR SELECT TO authenticated USING (public.can_access_client(client_id, auth.uid()));

--
-- Name: calendar_events calendar_events_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_events_delete ON public.calendar_events FOR DELETE TO authenticated USING ((((is_global = true) AND public.is_super_admin(auth.uid())) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: calendar_events calendar_events_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_events_insert ON public.calendar_events FOR INSERT TO authenticated WITH CHECK ((((is_global = true) AND public.is_super_admin(auth.uid())) OR ((is_global = false) AND public.client_in_scope(client_id, brand_id))));

--
-- Name: calendar_events calendar_events_select_global_or_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_events_select_global_or_scope ON public.calendar_events FOR SELECT TO authenticated USING (((is_global = true) OR public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: calendar_events calendar_events_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_events_update ON public.calendar_events FOR UPDATE TO authenticated USING ((((is_global = true) AND public.is_super_admin(auth.uid())) OR public.client_in_scope(client_id, brand_id))) WITH CHECK ((((is_global = true) AND public.is_super_admin(auth.uid())) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: chat_conversations chat_conversations_owner_in_client_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_conversations_owner_in_client_scope ON public.chat_conversations TO authenticated USING (((user_id = auth.uid()) AND public.client_in_scope(client_id, brand_id))) WITH CHECK (((user_id = auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: chat_messages chat_messages_inherit_conversation_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_inherit_conversation_scope ON public.chat_messages TO authenticated USING (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND (c.user_id = auth.uid()) AND public.client_in_scope(c.client_id, c.brand_id)))))) WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND (c.user_id = auth.uid()) AND public.client_in_scope(c.client_id, c.brand_id))))));

--
-- Name: client_members client memberships delete in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "client memberships delete in scope" ON public.client_members FOR DELETE TO authenticated USING ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: client_members client memberships manage in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "client memberships manage in scope" ON public.client_members FOR INSERT TO authenticated WITH CHECK ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: client_members client memberships read in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "client memberships read in scope" ON public.client_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))));

--
-- Name: client_members client memberships update in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "client memberships update in scope" ON public.client_members FOR UPDATE TO authenticated USING ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))) WITH CHECK ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: clients clients delete in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients delete in scope" ON public.clients FOR DELETE TO authenticated USING ((public.can_access_client_row(id, brand_id, owner_user_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text]))));

--
-- Name: clients clients insert admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients insert admins" ON public.clients FOR INSERT TO authenticated WITH CHECK ((public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text])));

--
-- Name: clients clients read in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients read in scope" ON public.clients FOR SELECT TO authenticated USING ((public.can_access_client_row(id, brand_id, owner_user_id, auth.uid()) OR public.is_portal_client_of(id, auth.uid())));

--
-- Name: clients clients update staff in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients update staff in scope" ON public.clients FOR UPDATE TO authenticated USING ((public.can_access_client_row(id, brand_id, owner_user_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'user'::text])))) WITH CHECK ((public.can_access_client_row(id, brand_id, owner_user_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'user'::text]))));

--
-- Name: brand_cohorts cohorts in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "cohorts in client scope" ON public.brand_cohorts TO authenticated USING (public.client_in_scope(client_id, brand_id)) WITH CHECK (public.client_in_scope(client_id, brand_id));

--
-- Name: client_social_accounts csa admins delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "csa admins delete" ON public.client_social_accounts FOR DELETE TO authenticated USING ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: client_social_accounts csa admins insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "csa admins insert" ON public.client_social_accounts FOR INSERT TO authenticated WITH CHECK ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: client_social_accounts csa admins update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "csa admins update" ON public.client_social_accounts FOR UPDATE TO authenticated USING ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))) WITH CHECK ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: client_social_accounts csa in client scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "csa in client scope read" ON public.client_social_accounts FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: client_social_accounts csa super admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "csa super admin" ON public.client_social_accounts TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: client_documents documents in client scope delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "documents in client scope delete" ON public.client_documents FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: client_documents documents in client scope insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "documents in client scope insert" ON public.client_documents FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));

--
-- Name: client_documents documents in client scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "documents in client scope read" ON public.client_documents FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: client_documents documents in client scope update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "documents in client scope update" ON public.client_documents FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id)) WITH CHECK (public.client_in_scope(client_id, brand_id));

--
-- Name: evolution_events evolution_events_select_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evolution_events_select_scope ON public.evolution_events FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: evolution_instances evolution_instances_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evolution_instances_delete_admin ON public.evolution_instances FOR DELETE TO authenticated USING (((public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text])) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: evolution_instances evolution_instances_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evolution_instances_insert_admin ON public.evolution_instances FOR INSERT TO authenticated WITH CHECK (((public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text])) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: evolution_instances evolution_instances_select_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evolution_instances_select_scope ON public.evolution_instances FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: evolution_instances evolution_instances_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evolution_instances_update_admin ON public.evolution_instances FOR UPDATE TO authenticated USING (((public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text])) AND public.client_in_scope(client_id, brand_id))) WITH CHECK (((public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text])) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: feature_catalog feature_catalog_delete_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feature_catalog_delete_superadmin ON public.feature_catalog FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

--
-- Name: feature_catalog feature_catalog_insert_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feature_catalog_insert_superadmin ON public.feature_catalog FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: feature_catalog feature_catalog_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feature_catalog_select_authenticated ON public.feature_catalog FOR SELECT TO authenticated USING (true);

--
-- Name: feature_catalog feature_catalog_update_superadmin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feature_catalog_update_superadmin ON public.feature_catalog FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: installation installation_select_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY installation_select_public ON public.installation FOR SELECT USING (true);

--
-- Name: installation installation_update_super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY installation_update_super_admin ON public.installation FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: brands internal users create brand; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "internal users create brand" ON public.brands FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND public.can_create_brand(auth.uid())));

--
-- Name: brand_invites invitee reads own invite; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invitee reads own invite" ON public.brand_invites FOR SELECT TO authenticated USING ((lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text))));

--
-- Name: client_journey_events journey_events in client scope insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "journey_events in client scope insert" ON public.client_journey_events FOR INSERT TO authenticated WITH CHECK ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: client_journey_events journey_events in client scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "journey_events in client scope read" ON public.client_journey_events FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: brand_members managers manage user members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers manage user members" ON public.brand_members TO authenticated USING (((public.app_access_role(auth.uid(), brand_id) = 'manager'::text) AND (role = 'user'::public.app_role))) WITH CHECK (((public.app_access_role(auth.uid(), brand_id) = 'manager'::text) AND (role = 'user'::public.app_role)));

--
-- Name: brand_media_assets media in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "media in client scope" ON public.brand_media_assets TO authenticated USING ((public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id))) WITH CHECK ((public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id)));

--
-- Name: brands members read brand; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read brand" ON public.brands FOR SELECT TO authenticated USING (public.is_brand_member(id, auth.uid()));

--
-- Name: brand_members members read brand memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read brand memberships" ON public.brand_members FOR SELECT TO authenticated USING ((((user_id = auth.uid()) OR public.is_brand_member(brand_id, auth.uid())) AND ((NOT public.is_super_admin(user_id)) OR public.is_super_admin(auth.uid()))));

--
-- Name: message_logs message_logs_scoped_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_logs_scoped_insert ON public.message_logs FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin(auth.uid()) OR ((client_id IS NOT NULL) AND public.client_in_scope(client_id, brand_id)) OR ((client_id IS NULL) AND public.is_brand_member(brand_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = 'admin'::text))));

--
-- Name: message_logs message_logs_scoped_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_logs_scoped_select ON public.message_logs FOR SELECT TO authenticated USING ((public.is_super_admin(auth.uid()) OR ((client_id IS NOT NULL) AND public.client_in_scope(client_id, brand_id)) OR ((client_id IS NULL) AND public.is_brand_member(brand_id, auth.uid()) AND (public.app_access_role(auth.uid(), brand_id) = 'admin'::text))));

--
-- Name: monthly_plan_tokens monthly plan tokens in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "monthly plan tokens in client scope" ON public.monthly_plan_tokens TO authenticated USING (public.client_in_scope(client_id, brand_id)) WITH CHECK (public.client_in_scope(client_id, brand_id));

--
-- Name: plan_overage_requests overage admins decide; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "overage admins decide" ON public.plan_overage_requests FOR UPDATE TO authenticated USING ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))) WITH CHECK ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: plan_overage_requests overage admins delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "overage admins delete" ON public.plan_overage_requests FOR DELETE TO authenticated USING ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: plan_overage_requests overage in client scope insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "overage in client scope insert" ON public.plan_overage_requests FOR INSERT TO authenticated WITH CHECK ((public.client_in_scope(client_id, brand_id) AND (requested_by = auth.uid())));

--
-- Name: plan_overage_requests overage in client scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "overage in client scope read" ON public.plan_overage_requests FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: ai_jobs owner deletes ai_jobs in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner deletes ai_jobs in client scope" ON public.ai_jobs FOR DELETE TO authenticated USING (((auth.uid() = user_id) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: brands owner or super admin deletes brand; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner or super admin deletes brand" ON public.brands FOR DELETE TO authenticated USING (public.can_delete_brand(id, auth.uid()));

--
-- Name: ai_jobs owner updates ai_jobs in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner updates ai_jobs in client scope" ON public.ai_jobs FOR UPDATE TO authenticated USING (((auth.uid() = user_id) AND public.client_in_scope(client_id, brand_id))) WITH CHECK (((auth.uid() = user_id) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: brand_members owners manage brand members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owners manage brand members" ON public.brand_members TO authenticated USING (public.has_brand_role(brand_id, auth.uid(), 'owner'::public.app_role)) WITH CHECK (public.has_brand_role(brand_id, auth.uid(), 'owner'::public.app_role));

--
-- Name: content_pipelines pipelines in client scope delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pipelines in client scope delete" ON public.content_pipelines FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: content_pipelines pipelines in client scope insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pipelines in client scope insert" ON public.content_pipelines FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));

--
-- Name: content_pipelines pipelines in client scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pipelines in client scope read" ON public.content_pipelines FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: content_pipelines pipelines in client scope update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pipelines in client scope update" ON public.content_pipelines FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id)) WITH CHECK (public.client_in_scope(client_id, brand_id));

--
-- Name: monthly_plans plans delete agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "plans delete agency only" ON public.monthly_plans FOR DELETE TO authenticated USING ((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id)));

--
-- Name: monthly_plans plans insert agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "plans insert agency only" ON public.monthly_plans FOR INSERT TO authenticated WITH CHECK ((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id)));

--
-- Name: monthly_plans plans read scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "plans read scoped" ON public.monthly_plans FOR SELECT TO authenticated USING ((public.can_access_client(client_id, auth.uid()) OR public.is_portal_client_of(client_id, auth.uid())));

--
-- Name: monthly_plans plans update agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "plans update agency only" ON public.monthly_plans FOR UPDATE TO authenticated USING ((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id))) WITH CHECK ((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id)));

--
-- Name: brand_briefings portal client reads own briefing; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "portal client reads own briefing" ON public.brand_briefings FOR SELECT TO authenticated USING (public.is_portal_client_of(client_id, auth.uid()));

--
-- Name: posts posts delete agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "posts delete agency only" ON public.posts FOR DELETE TO authenticated USING ((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id)));

--
-- Name: posts posts insert agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "posts insert agency only" ON public.posts FOR INSERT TO authenticated WITH CHECK ((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id)));

--
-- Name: posts posts read scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "posts read scoped" ON public.posts FOR SELECT TO authenticated USING (((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id)) OR (public.is_portal_client_of(client_id, auth.uid()) AND (visible_in_portal IS TRUE) AND (deleted_at IS NULL))));

--
-- Name: posts posts update agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "posts update agency only" ON public.posts FOR UPDATE TO authenticated USING ((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id))) WITH CHECK ((public.can_access_client(client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), brand_id)));

--
-- Name: project_jobs project_jobs via parent project; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "project_jobs via parent project" ON public.project_jobs TO authenticated USING (public.can_access_project(project_id, auth.uid())) WITH CHECK (public.can_access_project(project_id, auth.uid()));

--
-- Name: project_templates project_templates delete brand; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "project_templates delete brand" ON public.project_templates FOR DELETE TO authenticated USING (((brand_id IS NOT NULL) AND public.is_brand_member(brand_id, auth.uid())));

--
-- Name: project_templates project_templates insert brand; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "project_templates insert brand" ON public.project_templates FOR INSERT TO authenticated WITH CHECK (((brand_id IS NOT NULL) AND public.is_brand_member(brand_id, auth.uid())));

--
-- Name: project_templates project_templates read visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "project_templates read visible" ON public.project_templates FOR SELECT TO authenticated USING ((is_system OR ((brand_id IS NOT NULL) AND public.is_brand_member(brand_id, auth.uid()))));

--
-- Name: project_templates project_templates update brand; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "project_templates update brand" ON public.project_templates FOR UPDATE TO authenticated USING (((brand_id IS NOT NULL) AND public.is_brand_member(brand_id, auth.uid()))) WITH CHECK (((brand_id IS NOT NULL) AND public.is_brand_member(brand_id, auth.uid())));

--
-- Name: projects projects read in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "projects read in scope" ON public.projects FOR SELECT TO authenticated USING (
CASE
    WHEN (client_id IS NULL) THEN (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text]))
    ELSE public.can_access_client(client_id, auth.uid())
END);

--
-- Name: projects projects write agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "projects write agency only" ON public.projects TO authenticated USING ((public.is_agency_operator(auth.uid(), brand_id) AND
CASE
    WHEN (client_id IS NULL) THEN (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text]))
    ELSE public.can_access_client(client_id, auth.uid())
END)) WITH CHECK ((public.is_agency_operator(auth.uid(), brand_id) AND
CASE
    WHEN (client_id IS NULL) THEN (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text]))
    ELSE public.can_access_client(client_id, auth.uid())
END));

--
-- Name: brain_reasoning_logs reasoning logs owner read in client scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "reasoning logs owner read in client scope" ON public.brain_reasoning_logs FOR SELECT TO authenticated USING (((user_id = auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: portal_tokens scoped members manage portal tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members manage portal tokens" ON public.portal_tokens TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.clients c
  WHERE ((c.id = portal_tokens.client_id) AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.clients c
  WHERE ((c.id = portal_tokens.client_id) AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, auth.uid())))));

--
-- Name: sla_rules sla_rules_read_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sla_rules_read_members ON public.sla_rules FOR SELECT TO authenticated USING (public.is_brand_member(brand_id, auth.uid()));

--
-- Name: sla_rules sla_rules_write_managers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sla_rules_write_managers ON public.sla_rules TO authenticated USING (public.is_brand_admin_level(brand_id, auth.uid())) WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));

--
-- Name: social_connections social_connections admins delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "social_connections admins delete" ON public.social_connections FOR DELETE TO authenticated USING ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: social_connections social_connections admins insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "social_connections admins insert" ON public.social_connections FOR INSERT TO authenticated WITH CHECK ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: social_connections social_connections admins update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "social_connections admins update" ON public.social_connections FOR UPDATE TO authenticated USING ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))) WITH CHECK ((public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));

--
-- Name: social_connections social_connections in scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "social_connections in scope read" ON public.social_connections FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: social_posts social_posts in client scope delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "social_posts in client scope delete" ON public.social_posts FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: social_posts social_posts in client scope insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "social_posts in client scope insert" ON public.social_posts FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));

--
-- Name: social_posts social_posts in client scope read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "social_posts in client scope read" ON public.social_posts FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: social_posts social_posts in client scope update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "social_posts in client scope update" ON public.social_posts FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: brand_journey_stage_templates stage_templates_modify_admin_manager; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stage_templates_modify_admin_manager ON public.brand_journey_stage_templates TO authenticated USING (public.is_brand_admin_level(brand_id, auth.uid())) WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));

--
-- Name: brand_journey_stage_templates stage_templates_select_brand_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stage_templates_select_brand_members ON public.brand_journey_stage_templates FOR SELECT TO authenticated USING (public.is_brand_member(brand_id, auth.uid()));

--
-- Name: task_subtasks subtasks delete via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subtasks delete via parent task" ON public.task_subtasks FOR DELETE TO authenticated USING (public.can_access_task(task_id, auth.uid()));

--
-- Name: task_subtasks subtasks insert via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subtasks insert via parent task" ON public.task_subtasks FOR INSERT TO authenticated WITH CHECK (public.can_access_task(task_id, auth.uid()));

--
-- Name: task_subtasks subtasks select via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subtasks select via parent task" ON public.task_subtasks FOR SELECT TO authenticated USING (public.can_access_task(task_id, auth.uid()));

--
-- Name: task_subtasks subtasks update via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subtasks update via parent task" ON public.task_subtasks FOR UPDATE TO authenticated USING (public.can_access_task(task_id, auth.uid())) WITH CHECK (public.can_access_task(task_id, auth.uid()));

--
-- Name: ai_model_catalog_overrides super admins read model overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "super admins read model overrides" ON public.ai_model_catalog_overrides FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

--
-- Name: ai_jobs super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.ai_jobs TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: brain_reasoning_logs super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.brain_reasoning_logs TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: brand_invites super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.brand_invites TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: brand_members super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.brand_members TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: chat_conversations super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.chat_conversations TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: chat_messages super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.chat_messages TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: notifications super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.notifications TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: social_connections super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.social_connections TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: social_posts super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.social_posts TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: user_profiles super_admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_full_access ON public.user_profiles TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

--
-- Name: task_comments task comments via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task comments via parent task" ON public.task_comments TO authenticated USING (public.can_access_task(task_id, auth.uid())) WITH CHECK (public.can_access_task(task_id, auth.uid()));

--
-- Name: tasks tasks read in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tasks read in scope" ON public.tasks FOR SELECT TO authenticated USING (
CASE
    WHEN (client_id IS NULL) THEN (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text]))
    ELSE public.can_access_client(client_id, auth.uid())
END);

--
-- Name: tasks tasks write agency only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tasks write agency only" ON public.tasks TO authenticated USING ((public.is_agency_operator(auth.uid(), brand_id) AND
CASE
    WHEN (client_id IS NULL) THEN (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text]))
    ELSE public.can_access_client(client_id, auth.uid())
END)) WITH CHECK ((public.is_agency_operator(auth.uid(), brand_id) AND
CASE
    WHEN (client_id IS NULL) THEN (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text]))
    ELSE public.can_access_client(client_id, auth.uid())
END));

--
-- Name: project_template_jobs template_jobs read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "template_jobs read" ON public.project_template_jobs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.project_templates t
  WHERE ((t.id = project_template_jobs.template_id) AND (t.is_system OR ((t.brand_id IS NOT NULL) AND public.is_brand_member(t.brand_id, auth.uid())))))));

--
-- Name: project_template_jobs template_jobs write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "template_jobs write" ON public.project_template_jobs TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.project_templates t
  WHERE ((t.id = project_template_jobs.template_id) AND (t.brand_id IS NOT NULL) AND public.is_brand_member(t.brand_id, auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.project_templates t
  WHERE ((t.id = project_template_jobs.template_id) AND (t.brand_id IS NOT NULL) AND public.is_brand_member(t.brand_id, auth.uid())))));

--
-- Name: project_template_tasks template_tasks read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "template_tasks read" ON public.project_template_tasks FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.project_template_jobs j
     JOIN public.project_templates t ON ((t.id = j.template_id)))
  WHERE ((j.id = project_template_tasks.template_job_id) AND (t.is_system OR ((t.brand_id IS NOT NULL) AND public.is_brand_member(t.brand_id, auth.uid())))))));

--
-- Name: project_template_tasks template_tasks write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "template_tasks write" ON public.project_template_tasks TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.project_template_jobs j
     JOIN public.project_templates t ON ((t.id = j.template_id)))
  WHERE ((j.id = project_template_tasks.template_job_id) AND (t.brand_id IS NOT NULL) AND public.is_brand_member(t.brand_id, auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.project_template_jobs j
     JOIN public.project_templates t ON ((t.id = j.template_id)))
  WHERE ((j.id = project_template_tasks.template_job_id) AND (t.brand_id IS NOT NULL) AND public.is_brand_member(t.brand_id, auth.uid())))));

--
-- Name: task_time_entries time_entries own delete via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "time_entries own delete via parent task" ON public.task_time_entries FOR DELETE TO authenticated USING (((user_id = auth.uid()) AND public.can_access_task(task_id, auth.uid())));

--
-- Name: task_time_entries time_entries own insert via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "time_entries own insert via parent task" ON public.task_time_entries FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND public.can_access_task(task_id, auth.uid())));

--
-- Name: task_time_entries time_entries own update via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "time_entries own update via parent task" ON public.task_time_entries FOR UPDATE TO authenticated USING (((user_id = auth.uid()) AND public.can_access_task(task_id, auth.uid()))) WITH CHECK (((user_id = auth.uid()) AND public.can_access_task(task_id, auth.uid())));

--
-- Name: task_time_entries time_entries read via parent task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "time_entries read via parent task" ON public.task_time_entries FOR SELECT TO authenticated USING (public.can_access_task(task_id, auth.uid()));

--
-- Name: monthly_plan_topics topics delete in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "topics delete in scope" ON public.monthly_plan_topics FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.monthly_plans mp
  WHERE ((mp.id = monthly_plan_topics.monthly_plan_id) AND public.can_access_client(mp.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), mp.brand_id)))));

--
-- Name: monthly_plan_topics topics insert in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "topics insert in scope" ON public.monthly_plan_topics FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.monthly_plans mp
  WHERE ((mp.id = monthly_plan_topics.monthly_plan_id) AND public.can_access_client(mp.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), mp.brand_id)))));

--
-- Name: monthly_plan_topics topics read in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "topics read in scope" ON public.monthly_plan_topics FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.monthly_plans mp
  WHERE ((mp.id = monthly_plan_topics.monthly_plan_id) AND (public.can_access_client(mp.client_id, auth.uid()) OR public.is_portal_client_of(mp.client_id, auth.uid()))))));

--
-- Name: monthly_plan_topics topics update in scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "topics update in scope" ON public.monthly_plan_topics FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.monthly_plans mp
  WHERE ((mp.id = monthly_plan_topics.monthly_plan_id) AND public.can_access_client(mp.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), mp.brand_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.monthly_plans mp
  WHERE ((mp.id = monthly_plan_topics.monthly_plan_id) AND public.can_access_client(mp.client_id, auth.uid()) AND public.is_agency_operator(auth.uid(), mp.brand_id)))));

--
-- Name: notifications user reads own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user reads own notifications" ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));

--
-- Name: notifications user updates own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user updates own notifications" ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

--
-- Name: notifications users create own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users create own notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND public.is_brand_member(brand_id, auth.uid())));

--
-- Name: whatsapp_recipients whatsapp_recipients_delete_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_recipients_delete_scoped ON public.whatsapp_recipients FOR DELETE TO authenticated USING ((public.client_in_scope(client_id, brand_id) AND ((client_id IS NOT NULL) OR (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text])))));

--
-- Name: whatsapp_recipients whatsapp_recipients_insert_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_recipients_insert_scoped ON public.whatsapp_recipients FOR INSERT TO authenticated WITH CHECK ((public.client_in_scope(client_id, brand_id) AND ((client_id IS NOT NULL) OR (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text])))));

--
-- Name: whatsapp_recipients whatsapp_recipients_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_recipients_select_scoped ON public.whatsapp_recipients FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

--
-- Name: whatsapp_recipients whatsapp_recipients_update_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_recipients_update_scoped ON public.whatsapp_recipients FOR UPDATE TO authenticated USING ((public.client_in_scope(client_id, brand_id) AND ((client_id IS NOT NULL) OR (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text]))))) WITH CHECK ((public.client_in_scope(client_id, brand_id) AND ((client_id IS NOT NULL) OR (public.app_access_role(auth.uid(), brand_id) = ANY (ARRAY['super_admin'::text, 'admin'::text])))));


-- ============================ COMMENTS (23) ============================

--
-- Name: FUNCTION block_unusable_scheduled_social_posts(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.block_unusable_scheduled_social_posts() IS 'Uso interno (service_role / worker publish-scheduled). EXECUTE revogado de PUBLIC, anon e authenticated (V6).';

--
-- Name: FUNCTION brain_retention_run(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.brain_retention_run() IS 'Ensure partitions + archive + ttl cleanup. Agendar diariamente.';

--
-- Name: FUNCTION can_access_project(_project_id uuid, _user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.can_access_project(_project_id uuid, _user_id uuid) IS 'Escopo canônico de projeto: membro do workspace E (projeto sem cliente OU cliente no escopo do usuário).';

--
-- Name: FUNCTION client_in_scope(_client_id uuid, _brand_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.client_in_scope(_client_id uuid, _brand_id uuid) IS 'Predicado de escopo de cliente (RLS). EXECUTE apenas authenticated/service_role.';

--
-- Name: FUNCTION guard_super_admin_flag(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_super_admin_flag() IS 'Guarda de campos privilegiados de user_profiles (role, is_super_admin): grava somente quando auth.uid() e nulo (rotina interna/service_role) ou o ator e super admin.';

--
-- Name: FUNCTION is_agency_operator(_user_id uuid, _brand_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_agency_operator(_user_id uuid, _brand_id uuid) IS 'Operador interno do workspace (super_admin/admin/manager/user) — NÃO é verificação de autoridade administrativa nem de escopo de cliente.';

--
-- Name: FUNCTION is_client_assigned(_user_id uuid, _client_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_client_assigned(_user_id uuid, _client_id uuid) IS 'Fonte única de "cliente atribuído": clients.owner_user_id ou client_members (não portal).';

--
-- Name: FUNCTION is_global_admin(_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_global_admin(_user_id uuid) IS 'DEPRECIADA (Fase 1 RBAC): ADMIN é sempre escopado ao workspace. Retorna sempre false. Acesso global = is_super_admin.';

--
-- Name: FUNCTION message_logs_guard_scope(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.message_logs_guard_scope() IS 'Fase 10B: trigger interno. Valida clients.brand_id = message_logs.brand_id. Sem EXECUTE público.';

--
-- Name: TABLE brain_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.brain_events IS 'Barramento de eventos do Brain. Tabela unica (nao particionada) desde a ETAPA 3 da simplificacao.';

--
-- Name: COLUMN brands.app_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.brands.app_url IS 'URL canonica da instalacao que atende este workspace. Aprendida do host real das requisicoes e usada por jobs/cron/workers para montar links absolutos sem depender de variavel de ambiente global.';

--
-- Name: COLUMN posts.target_connection_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.posts.target_connection_ids IS 'IDs de social_connections que este post deve publicar. Referenciados por aplicação (validados por brand/cliente no server function).';

--
-- Name: TABLE client_social_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_social_accounts IS 'Unica fonte de verdade do vinculo canal <-> cliente.';

--
-- Name: COLUMN clients.portal_theme; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.portal_theme IS 'Tema do portal público: { mode: system|custom, accent, logo_url, bg, dark, footer_label, show_agency_credit }';

--
-- Name: COLUMN content_pipeline_stages.sla_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.content_pipeline_stages.sla_hours IS 'SLA em horas para a etapa. Coluna canônica; sla_days permanece como legado (compat).';

--
-- Name: COLUMN message_logs.client_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.message_logs.client_id IS 'Fase 10B: cliente do registro. NULL = registro de workspace (visível só para admin/super admin).';

--
-- Name: TABLE meta_compliance_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.meta_compliance_events IS 'Uso interno (service role). RLS sem policies nega acesso via Data API.';

--
-- Name: TABLE portal_rate_limit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.portal_rate_limit IS 'Uso interno (service role). RLS sem policies nega acesso via Data API.';

--
-- Name: TABLE social_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.social_connections IS 'Integracao/canal social no nivel do WORKSPACE (brand). Nao representa vinculo com cliente.';

--
-- Name: COLUMN social_connections.client_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_connections.client_id IS 'DEPRECATED (Fase 1): nao use. Vinculo canal<->cliente vive em public.client_social_accounts.';

--
-- Name: COLUMN social_connections.page_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_connections.page_id IS 'Facebook Page ID (Meta).';

--
-- Name: COLUMN social_connections.instagram_business_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_connections.instagram_business_id IS 'Instagram Business Account ID (Meta).';

--
-- Name: COLUMN social_connections.meta_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_connections.meta_user_id IS 'Meta user/app-scoped user id (owner).';


-- ============================ GRANTS / REVOKES (635) ============================

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;

GRANT USAGE ON SCHEMA public TO anon;

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT USAGE ON SCHEMA public TO service_role;

--
-- Name: FUNCTION _brain_cfg_days(_key text, _default integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._brain_cfg_days(_key text, _default integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public._brain_cfg_days(_key text, _default integer) TO service_role;

--
-- Name: FUNCTION _portal_session(_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._portal_session(_token text) FROM PUBLIC;

GRANT ALL ON FUNCTION public._portal_session(_token text) TO service_role;

--
-- Name: FUNCTION _portal_session_any(_token text, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._portal_session_any(_token text, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public._portal_session_any(_token text, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public._portal_session_any(_token text, _client_id uuid) TO service_role;

--
-- Name: FUNCTION _portal_session_user(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._portal_session_user(_client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public._portal_session_user(_client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public._portal_session_user(_client_id uuid) TO service_role;

--
-- Name: FUNCTION accept_brand_invite(_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.accept_brand_invite(_token text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.accept_brand_invite(_token text) TO service_role;

GRANT ALL ON FUNCTION public.accept_brand_invite(_token text) TO authenticated;

--
-- Name: FUNCTION add_brand_owner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_brand_owner() FROM PUBLIC;

GRANT ALL ON FUNCTION public.add_brand_owner() TO service_role;

--
-- Name: FUNCTION app_access_role(_user_id uuid, _brand_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.app_access_role(_user_id uuid, _brand_id uuid) TO service_role;

--
-- Name: FUNCTION block_unusable_scheduled_social_posts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.block_unusable_scheduled_social_posts() FROM PUBLIC;

GRANT ALL ON FUNCTION public.block_unusable_scheduled_social_posts() TO service_role;

--
-- Name: FUNCTION brain_cleanup_ttl(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_cleanup_ttl() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_cleanup_ttl() TO service_role;

--
-- Name: FUNCTION brain_confidence(_sample integer, _consistency numeric, _last_observed timestamp with time zone, _relevance numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_confidence(_sample integer, _consistency numeric, _last_observed timestamp with time zone, _relevance numeric) FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_confidence(_sample integer, _consistency numeric, _last_observed timestamp with time zone, _relevance numeric) TO service_role;

--
-- Name: FUNCTION brain_events_guard_identity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_events_guard_identity() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_events_guard_identity() TO service_role;

--
-- Name: FUNCTION brain_events_prune(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_events_prune() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_events_prune() TO service_role;

--
-- Name: FUNCTION brain_memory_decay_and_archive(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_memory_decay_and_archive() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_memory_decay_and_archive() TO service_role;

--
-- Name: FUNCTION brain_memory_evolve(_brand_id uuid, _entity_type text, _entity_id uuid, _category text, _title text, _description text, _content jsonb, _evidence_confidence numeric, _origin text, _source_event uuid, _tags text[], _relations jsonb, _metadata jsonb, _contradicts boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_memory_evolve(_brand_id uuid, _entity_type text, _entity_id uuid, _category text, _title text, _description text, _content jsonb, _evidence_confidence numeric, _origin text, _source_event uuid, _tags text[], _relations jsonb, _metadata jsonb, _contradicts boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_memory_evolve(_brand_id uuid, _entity_type text, _entity_id uuid, _category text, _title text, _description text, _content jsonb, _evidence_confidence numeric, _origin text, _source_event uuid, _tags text[], _relations jsonb, _metadata jsonb, _contradicts boolean) TO service_role;

GRANT ALL ON FUNCTION public.brain_memory_evolve(_brand_id uuid, _entity_type text, _entity_id uuid, _category text, _title text, _description text, _content jsonb, _evidence_confidence numeric, _origin text, _source_event uuid, _tags text[], _relations jsonb, _metadata jsonb, _contradicts boolean) TO authenticated;

--
-- Name: FUNCTION brain_memory_guard_scope(_brand_id uuid, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_memory_guard_scope(_brand_id uuid, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_memory_guard_scope(_brand_id uuid, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.brain_memory_guard_scope(_brand_id uuid, _client_id uuid) TO service_role;

--
-- Name: FUNCTION brain_memory_snapshot(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_memory_snapshot() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_memory_snapshot() TO service_role;

--
-- Name: FUNCTION brain_memory_touch(_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_memory_touch(_ids uuid[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_memory_touch(_ids uuid[]) TO service_role;

GRANT ALL ON FUNCTION public.brain_memory_touch(_ids uuid[]) TO authenticated;

--
-- Name: FUNCTION brain_mine_patterns(_brand_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_mine_patterns(_brand_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_mine_patterns(_brand_id uuid) TO service_role;

--
-- Name: FUNCTION brain_render_memory_desc(_category text, _content jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.brain_render_memory_desc(_category text, _content jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.brain_render_memory_desc(_category text, _content jsonb) TO service_role;

--
-- Name: FUNCTION brain_retention_run(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_retention_run() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_retention_run() TO service_role;

--
-- Name: FUNCTION brain_run_mining_safe(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_run_mining_safe() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_run_mining_safe() TO service_role;

--
-- Name: FUNCTION brain_scope_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.brain_scope_guard() TO anon;

GRANT ALL ON FUNCTION public.brain_scope_guard() TO authenticated;

GRANT ALL ON FUNCTION public.brain_scope_guard() TO service_role;

--
-- Name: FUNCTION brain_set_last_observed(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.brain_set_last_observed() TO anon;

GRANT ALL ON FUNCTION public.brain_set_last_observed() TO authenticated;

GRANT ALL ON FUNCTION public.brain_set_last_observed() TO service_role;

--
-- Name: FUNCTION brain_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_touch_updated_at() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_touch_updated_at() TO service_role;

--
-- Name: FUNCTION brain_trg_client_documents(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_trg_client_documents() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_trg_client_documents() TO service_role;

--
-- Name: FUNCTION brain_trg_clients(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_trg_clients() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_trg_clients() TO service_role;

--
-- Name: FUNCTION brain_trg_post_approvals(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_trg_post_approvals() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_trg_post_approvals() TO service_role;

--
-- Name: FUNCTION brain_trg_posts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_trg_posts() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_trg_posts() TO service_role;

--
-- Name: FUNCTION brain_trg_projects(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_trg_projects() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_trg_projects() TO service_role;

--
-- Name: FUNCTION brain_trg_task_comments(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_trg_task_comments() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_trg_task_comments() TO service_role;

--
-- Name: FUNCTION brain_trg_tasks(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brain_trg_tasks() FROM PUBLIC;

GRANT ALL ON FUNCTION public.brain_trg_tasks() TO service_role;

--
-- Name: FUNCTION brand_member_role(_user_id uuid, _brand_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.brand_member_role(_user_id uuid, _brand_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.brand_member_role(_user_id uuid, _brand_id uuid) TO anon;

GRANT ALL ON FUNCTION public.brand_member_role(_user_id uuid, _brand_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.brand_member_role(_user_id uuid, _brand_id uuid) TO service_role;

--
-- Name: FUNCTION bump_chat_conversation_last_message(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bump_chat_conversation_last_message() FROM PUBLIC;

GRANT ALL ON FUNCTION public.bump_chat_conversation_last_message() TO service_role;

--
-- Name: FUNCTION calendar_events_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calendar_events_touch_updated_at() FROM PUBLIC;

GRANT ALL ON FUNCTION public.calendar_events_touch_updated_at() TO service_role;

--
-- Name: FUNCTION can_access_client(_client_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_client(_client_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_access_client(_client_id uuid, _user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.can_access_client(_client_id uuid, _user_id uuid) TO authenticated;

--
-- Name: FUNCTION can_access_client_row(_client_id uuid, _brand_id uuid, _owner_user_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_client_row(_client_id uuid, _brand_id uuid, _owner_user_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_access_client_row(_client_id uuid, _brand_id uuid, _owner_user_id uuid, _user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.can_access_client_row(_client_id uuid, _brand_id uuid, _owner_user_id uuid, _user_id uuid) TO service_role;

--
-- Name: FUNCTION can_access_project(_project_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_project(_project_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_access_project(_project_id uuid, _user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.can_access_project(_project_id uuid, _user_id uuid) TO service_role;

--
-- Name: FUNCTION can_access_task(_task_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_task(_task_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_access_task(_task_id uuid, _user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.can_access_task(_task_id uuid, _user_id uuid) TO service_role;

--
-- Name: FUNCTION can_create_brand(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_create_brand(_user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_create_brand(_user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.can_create_brand(_user_id uuid) TO service_role;

--
-- Name: FUNCTION can_delete_brand(_brand_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_delete_brand(_brand_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_delete_brand(_brand_id uuid, _user_id uuid) TO anon;

GRANT ALL ON FUNCTION public.can_delete_brand(_brand_id uuid, _user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.can_delete_brand(_brand_id uuid, _user_id uuid) TO service_role;

--
-- Name: FUNCTION can_invite_brand_role(_brand_id uuid, _actor_id uuid, _role public.app_role, _email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_invite_brand_role(_brand_id uuid, _actor_id uuid, _role public.app_role, _email text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_invite_brand_role(_brand_id uuid, _actor_id uuid, _role public.app_role, _email text) TO authenticated;

GRANT ALL ON FUNCTION public.can_invite_brand_role(_brand_id uuid, _actor_id uuid, _role public.app_role, _email text) TO service_role;

--
-- Name: FUNCTION can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.can_manage_brand_ai_limits(_brand_id uuid, _user_id uuid) TO authenticated;

--
-- Name: FUNCTION canonical_content_format(_raw text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.canonical_content_format(_raw text) TO anon;

GRANT ALL ON FUNCTION public.canonical_content_format(_raw text) TO authenticated;

GRANT ALL ON FUNCTION public.canonical_content_format(_raw text) TO service_role;

--
-- Name: FUNCTION card_approval_public_decide(_token text, _verb text, _comment text, _ip text, _ua text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.card_approval_public_decide(_token text, _verb text, _comment text, _ip text, _ua text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.card_approval_public_decide(_token text, _verb text, _comment text, _ip text, _ua text) TO service_role;

--
-- Name: FUNCTION check_ai_usage_budget(_brand_id uuid, _client_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_ai_usage_budget(_brand_id uuid, _client_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.check_ai_usage_budget(_brand_id uuid, _client_id uuid, _user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.check_ai_usage_budget(_brand_id uuid, _client_id uuid, _user_id uuid) TO authenticated;

--
-- Name: FUNCTION claim_scheduled_social_posts(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_scheduled_social_posts(p_limit integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.claim_scheduled_social_posts(p_limit integer) TO service_role;

--
-- Name: FUNCTION client_in_scope(_client_id uuid, _brand_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_in_scope(_client_id uuid, _brand_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.client_in_scope(_client_id uuid, _brand_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.client_in_scope(_client_id uuid, _brand_id uuid) TO service_role;

--
-- Name: FUNCTION clients_set_default_owner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clients_set_default_owner() FROM PUBLIC;

GRANT ALL ON FUNCTION public.clients_set_default_owner() TO service_role;

--
-- Name: FUNCTION consolidate_brain_memory(_brand_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.consolidate_brain_memory(_brand_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.consolidate_brain_memory(_brand_id uuid) TO service_role;

--
-- Name: FUNCTION cron_secret(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cron_secret() FROM PUBLIC;

GRANT ALL ON FUNCTION public.cron_secret() TO service_role;

--
-- Name: FUNCTION derive_post_stage(_stage_id uuid, _current public.post_stage); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.derive_post_stage(_stage_id uuid, _current public.post_stage) FROM PUBLIC;

GRANT ALL ON FUNCTION public.derive_post_stage(_stage_id uuid, _current public.post_stage) TO service_role;

--
-- Name: FUNCTION derive_relationships_from_event(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.derive_relationships_from_event(_event_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.derive_relationships_from_event(_event_id uuid) TO service_role;

--
-- Name: FUNCTION emit_brain_event(p_brand_id uuid, p_event_type text, p_source_module text, p_actor_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_client_id uuid, p_project_id uuid, p_payload jsonb, p_confidence numeric, p_correlation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.emit_brain_event(p_brand_id uuid, p_event_type text, p_source_module text, p_actor_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_client_id uuid, p_project_id uuid, p_payload jsonb, p_confidence numeric, p_correlation_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.emit_brain_event(p_brand_id uuid, p_event_type text, p_source_module text, p_actor_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_client_id uuid, p_project_id uuid, p_payload jsonb, p_confidence numeric, p_correlation_id uuid) TO service_role;

--
-- Name: FUNCTION enable_default_brand_features(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enable_default_brand_features() FROM PUBLIC;

GRANT ALL ON FUNCTION public.enable_default_brand_features() TO service_role;

--
-- Name: FUNCTION enforce_task_project_client(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_task_project_client() FROM PUBLIC;

GRANT ALL ON FUNCTION public.enforce_task_project_client() TO service_role;

--
-- Name: FUNCTION enqueue_brain_event_for_learning(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enqueue_brain_event_for_learning() FROM PUBLIC;

GRANT ALL ON FUNCTION public.enqueue_brain_event_for_learning() TO service_role;

--
-- Name: FUNCTION enqueue_deadline_notifications(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enqueue_deadline_notifications() FROM PUBLIC;

GRANT ALL ON FUNCTION public.enqueue_deadline_notifications() TO service_role;

--
-- Name: FUNCTION find_user_id_by_email(_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.find_user_id_by_email(_email text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.find_user_id_by_email(_email text) TO service_role;

--
-- Name: FUNCTION get_brain_graph(_brand_id uuid, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_brain_graph(_brand_id uuid, _limit integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_brain_graph(_brand_id uuid, _limit integer) TO service_role;

GRANT ALL ON FUNCTION public.get_brain_graph(_brand_id uuid, _limit integer) TO authenticated;

--
-- Name: FUNCTION get_brain_neighborhood(_brand_id uuid, _entity_type text, _entity_id uuid, _depth integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_brain_neighborhood(_brand_id uuid, _entity_type text, _entity_id uuid, _depth integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_brain_neighborhood(_brand_id uuid, _entity_type text, _entity_id uuid, _depth integer) TO service_role;

GRANT ALL ON FUNCTION public.get_brain_neighborhood(_brand_id uuid, _entity_type text, _entity_id uuid, _depth integer) TO authenticated;

--
-- Name: FUNCTION guard_super_admin_flag(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_super_admin_flag() FROM PUBLIC;

GRANT ALL ON FUNCTION public.guard_super_admin_flag() TO service_role;

--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

--
-- Name: FUNCTION has_brand_role(_brand_id uuid, _user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_brand_role(_brand_id uuid, _user_id uuid, _role public.app_role) FROM PUBLIC;

GRANT ALL ON FUNCTION public.has_brand_role(_brand_id uuid, _user_id uuid, _role public.app_role) TO service_role;

GRANT ALL ON FUNCTION public.has_brand_role(_brand_id uuid, _user_id uuid, _role public.app_role) TO authenticated;

--
-- Name: FUNCTION instantiate_project_template(_template_id uuid, _brand_id uuid, _client_id uuid, _project_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.instantiate_project_template(_template_id uuid, _brand_id uuid, _client_id uuid, _project_name text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.instantiate_project_template(_template_id uuid, _brand_id uuid, _client_id uuid, _project_name text) TO service_role;

GRANT ALL ON FUNCTION public.instantiate_project_template(_template_id uuid, _brand_id uuid, _client_id uuid, _project_name text) TO authenticated;

--
-- Name: FUNCTION is_agency_operator(_user_id uuid, _brand_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_agency_operator(_user_id uuid, _brand_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_agency_operator(_user_id uuid, _brand_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_agency_operator(_user_id uuid, _brand_id uuid) TO service_role;

--
-- Name: FUNCTION is_brand_admin_level(_brand_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_brand_admin_level(_brand_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_brand_admin_level(_brand_id uuid, _user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_brand_admin_level(_brand_id uuid, _user_id uuid) TO service_role;

--
-- Name: FUNCTION is_brand_member(_brand_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_brand_member(_brand_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_brand_member(_brand_id uuid, _user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_brand_member(_brand_id uuid, _user_id uuid) TO authenticated;

--
-- Name: FUNCTION is_client_assigned(_user_id uuid, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_client_assigned(_user_id uuid, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_client_assigned(_user_id uuid, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_client_assigned(_user_id uuid, _client_id uuid) TO service_role;

--
-- Name: FUNCTION is_global_admin(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_global_admin(_user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_global_admin(_user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_global_admin(_user_id uuid) TO service_role;

--
-- Name: FUNCTION is_portal_client_of(_client_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_portal_client_of(_client_id uuid, _user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_portal_client_of(_client_id uuid, _user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_portal_client_of(_client_id uuid, _user_id uuid) TO service_role;

--
-- Name: FUNCTION is_portal_user(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_portal_user(_user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_portal_user(_user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_portal_user(_user_id uuid) TO service_role;

--
-- Name: FUNCTION is_super_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_super_admin() TO service_role;

GRANT ALL ON FUNCTION public.is_super_admin() TO authenticated;

--
-- Name: FUNCTION is_super_admin(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_super_admin(_user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.is_super_admin(_user_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_super_admin(_user_id uuid) TO authenticated;

--
-- Name: FUNCTION link_existing_user_to_brand(_brand_id uuid, _email text, _role public.app_role, _permissions jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_existing_user_to_brand(_brand_id uuid, _email text, _role public.app_role, _permissions jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.link_existing_user_to_brand(_brand_id uuid, _email text, _role public.app_role, _permissions jsonb) TO service_role;

GRANT ALL ON FUNCTION public.link_existing_user_to_brand(_brand_id uuid, _email text, _role public.app_role, _permissions jsonb) TO authenticated;

--
-- Name: FUNCTION list_agent_catalog(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_agent_catalog() FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_agent_catalog() TO service_role;

GRANT ALL ON FUNCTION public.list_agent_catalog() TO authenticated;

--
-- Name: FUNCTION list_ai_usage_overview(_brand_id uuid, _period_start timestamp with time zone, _period_end timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_ai_usage_overview(_brand_id uuid, _period_start timestamp with time zone, _period_end timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_ai_usage_overview(_brand_id uuid, _period_start timestamp with time zone, _period_end timestamp with time zone) TO service_role;

GRANT ALL ON FUNCTION public.list_ai_usage_overview(_brand_id uuid, _period_start timestamp with time zone, _period_end timestamp with time zone) TO authenticated;

--
-- Name: FUNCTION log_post_activity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_post_activity() FROM PUBLIC;

GRANT ALL ON FUNCTION public.log_post_activity() TO service_role;

--
-- Name: FUNCTION log_task_activity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_task_activity() FROM PUBLIC;

GRANT ALL ON FUNCTION public.log_task_activity() TO service_role;

--
-- Name: FUNCTION mark_social_post_blocked(p_post_id uuid, p_error text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_social_post_blocked(p_post_id uuid, p_error text, p_reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.mark_social_post_blocked(p_post_id uuid, p_error text, p_reason text) TO service_role;

--
-- Name: FUNCTION mark_social_post_failed(p_post_id uuid, p_error text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_social_post_failed(p_post_id uuid, p_error text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.mark_social_post_failed(p_post_id uuid, p_error text) TO service_role;

--
-- Name: FUNCTION mark_social_post_published(p_post_id uuid, p_external_id text, p_permalink text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_social_post_published(p_post_id uuid, p_external_id text, p_permalink text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.mark_social_post_published(p_post_id uuid, p_external_id text, p_permalink text) TO service_role;

--
-- Name: FUNCTION match_brain_events(_brand_id uuid, _query public.vector, _match_count integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_brain_events(_brand_id uuid, _query public.vector, _match_count integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.match_brain_events(_brand_id uuid, _query public.vector, _match_count integer) TO service_role;

GRANT ALL ON FUNCTION public.match_brain_events(_brand_id uuid, _query public.vector, _match_count integer) TO authenticated;

--
-- Name: FUNCTION media_plan_public_items(_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.media_plan_public_items(_token text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.media_plan_public_items(_token text) TO service_role;

GRANT ALL ON FUNCTION public.media_plan_public_items(_token text) TO anon;

GRANT ALL ON FUNCTION public.media_plan_public_items(_token text) TO authenticated;

--
-- Name: FUNCTION media_plan_public_resolve(_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.media_plan_public_resolve(_token text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.media_plan_public_resolve(_token text) TO service_role;

GRANT ALL ON FUNCTION public.media_plan_public_resolve(_token text) TO anon;

GRANT ALL ON FUNCTION public.media_plan_public_resolve(_token text) TO authenticated;

--
-- Name: FUNCTION message_logs_guard_scope(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.message_logs_guard_scope() FROM PUBLIC;

GRANT ALL ON FUNCTION public.message_logs_guard_scope() TO service_role;

--
-- Name: FUNCTION my_access(_brand_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_access(_brand_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.my_access(_brand_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.my_access(_brand_id uuid) TO service_role;

--
-- Name: FUNCTION normalize_app_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalize_app_role() TO anon;

GRANT ALL ON FUNCTION public.normalize_app_role() TO authenticated;

GRANT ALL ON FUNCTION public.normalize_app_role() TO service_role;

--
-- Name: FUNCTION normalize_client_member_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalize_client_member_role() TO anon;

GRANT ALL ON FUNCTION public.normalize_client_member_role() TO authenticated;

GRANT ALL ON FUNCTION public.normalize_client_member_role() TO service_role;

--
-- Name: FUNCTION notification_pref_for_kind(_kind text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notification_pref_for_kind(_kind text) TO anon;

GRANT ALL ON FUNCTION public.notification_pref_for_kind(_kind text) TO authenticated;

GRANT ALL ON FUNCTION public.notification_pref_for_kind(_kind text) TO service_role;

--
-- Name: FUNCTION notification_prefs_allows(_user_id uuid, _kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notification_prefs_allows(_user_id uuid, _kind text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.notification_prefs_allows(_user_id uuid, _kind text) TO authenticated;

GRANT ALL ON FUNCTION public.notification_prefs_allows(_user_id uuid, _kind text) TO service_role;

--
-- Name: FUNCTION notify_ai_job_completed(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_ai_job_completed() FROM PUBLIC;

GRANT ALL ON FUNCTION public.notify_ai_job_completed() TO service_role;

--
-- Name: FUNCTION notify_post_approval_events(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_post_approval_events() FROM PUBLIC;

GRANT ALL ON FUNCTION public.notify_post_approval_events() TO service_role;

--
-- Name: FUNCTION notify_task_assigned(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_task_assigned() FROM PUBLIC;

GRANT ALL ON FUNCTION public.notify_task_assigned() TO service_role;

--
-- Name: FUNCTION notify_task_mentions(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_task_mentions() FROM PUBLIC;

GRANT ALL ON FUNCTION public.notify_task_mentions() TO service_role;

--
-- Name: FUNCTION portal_approvals(_token text, _status text, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_approvals(_token text, _status text, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_approvals(_token text, _status text, _client_id uuid) TO anon;

GRANT ALL ON FUNCTION public.portal_approvals(_token text, _status text, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_approvals(_token text, _status text, _client_id uuid) TO service_role;

--
-- Name: FUNCTION portal_briefings(_token text, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_briefings(_token text, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_briefings(_token text, _client_id uuid) TO anon;

GRANT ALL ON FUNCTION public.portal_briefings(_token text, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_briefings(_token text, _client_id uuid) TO service_role;

--
-- Name: FUNCTION portal_calendar(_token text, _month text, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_calendar(_token text, _month text, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_calendar(_token text, _month text, _client_id uuid) TO anon;

GRANT ALL ON FUNCTION public.portal_calendar(_token text, _month text, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_calendar(_token text, _month text, _client_id uuid) TO service_role;

--
-- Name: FUNCTION portal_client_ids(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_client_ids(_user_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_client_ids(_user_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_client_ids(_user_id uuid) TO service_role;

--
-- Name: FUNCTION portal_decide(_token text, _post_id uuid, _decision text, _note text, _identity text, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_decide(_token text, _post_id uuid, _decision text, _note text, _identity text, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_decide(_token text, _post_id uuid, _decision text, _note text, _identity text, _client_id uuid) TO anon;

GRANT ALL ON FUNCTION public.portal_decide(_token text, _post_id uuid, _decision text, _note text, _identity text, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_decide(_token text, _post_id uuid, _decision text, _note text, _identity text, _client_id uuid) TO service_role;

--
-- Name: FUNCTION portal_files(_token text, _search text, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_files(_token text, _search text, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_files(_token text, _search text, _client_id uuid) TO anon;

GRANT ALL ON FUNCTION public.portal_files(_token text, _search text, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_files(_token text, _search text, _client_id uuid) TO service_role;

--
-- Name: FUNCTION portal_metrics(_token text, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_metrics(_token text, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_metrics(_token text, _client_id uuid) TO anon;

GRANT ALL ON FUNCTION public.portal_metrics(_token text, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_metrics(_token text, _client_id uuid) TO service_role;

--
-- Name: FUNCTION portal_my_clients(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_my_clients() FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_my_clients() TO anon;

GRANT ALL ON FUNCTION public.portal_my_clients() TO authenticated;

GRANT ALL ON FUNCTION public.portal_my_clients() TO service_role;

--
-- Name: FUNCTION portal_post(_token text, _post_id uuid, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_post(_token text, _post_id uuid, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_post(_token text, _post_id uuid, _client_id uuid) TO anon;

GRANT ALL ON FUNCTION public.portal_post(_token text, _post_id uuid, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_post(_token text, _post_id uuid, _client_id uuid) TO service_role;

--
-- Name: FUNCTION portal_rate_register_failure(_ip_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_rate_register_failure(_ip_hash text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_rate_register_failure(_ip_hash text) TO anon;

GRANT ALL ON FUNCTION public.portal_rate_register_failure(_ip_hash text) TO authenticated;

GRANT ALL ON FUNCTION public.portal_rate_register_failure(_ip_hash text) TO service_role;

--
-- Name: FUNCTION portal_rate_status(_ip_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_rate_status(_ip_hash text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_rate_status(_ip_hash text) TO anon;

GRANT ALL ON FUNCTION public.portal_rate_status(_ip_hash text) TO authenticated;

GRANT ALL ON FUNCTION public.portal_rate_status(_ip_hash text) TO service_role;

--
-- Name: FUNCTION portal_resolve(_token text, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_resolve(_token text, _client_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.portal_resolve(_token text, _client_id uuid) TO anon;

GRANT ALL ON FUNCTION public.portal_resolve(_token text, _client_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.portal_resolve(_token text, _client_id uuid) TO service_role;

--
-- Name: FUNCTION posts_sync_legacy_stage(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.posts_sync_legacy_stage() FROM PUBLIC;

GRANT ALL ON FUNCTION public.posts_sync_legacy_stage() TO service_role;

--
-- Name: FUNCTION posts_touch_stage_entered_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.posts_touch_stage_entered_at() FROM PUBLIC;

GRANT ALL ON FUNCTION public.posts_touch_stage_entered_at() TO service_role;

--
-- Name: FUNCTION process_brain_learning_queue(_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.process_brain_learning_queue(_limit integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.process_brain_learning_queue(_limit integer) TO service_role;

--
-- Name: FUNCTION protect_pipeline_delete(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.protect_pipeline_delete() FROM PUBLIC;

GRANT ALL ON FUNCTION public.protect_pipeline_delete() TO service_role;

--
-- Name: FUNCTION public_surface_rate_hit(_key text, _max integer, _window_seconds integer, _block_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.public_surface_rate_hit(_key text, _max integer, _window_seconds integer, _block_seconds integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.public_surface_rate_hit(_key text, _max integer, _window_seconds integer, _block_seconds integer) TO service_role;

--
-- Name: FUNCTION reactivate_portal_token(_token_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reactivate_portal_token(_token_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reactivate_portal_token(_token_id uuid) TO authenticated;

GRANT ALL ON FUNCTION public.reactivate_portal_token(_token_id uuid) TO service_role;

--
-- Name: FUNCTION reap_brain_learning_queue(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reap_brain_learning_queue() FROM PUBLIC;

GRANT ALL ON FUNCTION public.reap_brain_learning_queue() TO service_role;

--
-- Name: FUNCTION reap_stuck_ai_jobs(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reap_stuck_ai_jobs() FROM PUBLIC;

GRANT ALL ON FUNCTION public.reap_stuck_ai_jobs() TO service_role;

--
-- Name: FUNCTION recalc_media_plan_item_amount(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recalc_media_plan_item_amount() FROM PUBLIC;

GRANT ALL ON FUNCTION public.recalc_media_plan_item_amount() TO service_role;

--
-- Name: FUNCTION recalc_media_plan_items_on_plan(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recalc_media_plan_items_on_plan() FROM PUBLIC;

GRANT ALL ON FUNCTION public.recalc_media_plan_items_on_plan() TO service_role;

--
-- Name: FUNCTION refresh_brain_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_brain_stats() FROM PUBLIC;

GRANT ALL ON FUNCTION public.refresh_brain_stats() TO service_role;

--
-- Name: FUNCTION refresh_task_total_minutes(_task_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_task_total_minutes(_task_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.refresh_task_total_minutes(_task_id uuid) TO service_role;

--
-- Name: FUNCTION safe_uuid(_txt text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.safe_uuid(_txt text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.safe_uuid(_txt text) TO anon;

GRANT ALL ON FUNCTION public.safe_uuid(_txt text) TO authenticated;

GRANT ALL ON FUNCTION public.safe_uuid(_txt text) TO service_role;

--
-- Name: FUNCTION set_cron_secret(_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_cron_secret(_value text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_cron_secret(_value text) TO service_role;

--
-- Name: FUNCTION start_timer(_task_id uuid, _brand_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_timer(_task_id uuid, _brand_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.start_timer(_task_id uuid, _brand_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.start_timer(_task_id uuid, _brand_id uuid) TO authenticated;

--
-- Name: FUNCTION stop_timer(_entry_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stop_timer(_entry_id uuid, _reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.stop_timer(_entry_id uuid, _reason text) TO authenticated;

GRANT ALL ON FUNCTION public.stop_timer(_entry_id uuid, _reason text) TO service_role;

--
-- Name: FUNCTION storage_scope_allows(_bucket text, _name text, _write boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.storage_scope_allows(_bucket text, _name text, _write boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.storage_scope_allows(_bucket text, _name text, _write boolean) TO anon;

GRANT ALL ON FUNCTION public.storage_scope_allows(_bucket text, _name text, _write boolean) TO authenticated;

GRANT ALL ON FUNCTION public.storage_scope_allows(_bucket text, _name text, _write boolean) TO service_role;

--
-- Name: FUNCTION sync_post_publication_state(p_post_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_post_publication_state(p_post_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.sync_post_publication_state(p_post_id uuid) TO service_role;

--
-- Name: FUNCTION tg_ai_usage_limits_touch(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tg_ai_usage_limits_touch() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_ai_usage_limits_touch() TO service_role;

--
-- Name: FUNCTION tg_social_posts_sync_publication(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tg_social_posts_sync_publication() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_social_posts_sync_publication() TO service_role;

--
-- Name: FUNCTION tg_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tg_touch_updated_at() FROM PUBLIC;

GRANT ALL ON FUNCTION public.tg_touch_updated_at() TO service_role;

--
-- Name: FUNCTION trg_time_entry_refresh_totals(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trg_time_entry_refresh_totals() FROM PUBLIC;

GRANT ALL ON FUNCTION public.trg_time_entry_refresh_totals() TO service_role;

--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;

--
-- Name: FUNCTION upsert_brain_relationship(_brand_id uuid, _from_type text, _from_id uuid, _to_type text, _to_id uuid, _rel_type text, _strength_delta numeric, _metadata jsonb, _bidirectional boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_brain_relationship(_brand_id uuid, _from_type text, _from_id uuid, _to_type text, _to_id uuid, _rel_type text, _strength_delta numeric, _metadata jsonb, _bidirectional boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.upsert_brain_relationship(_brand_id uuid, _from_type text, _from_id uuid, _to_type text, _to_id uuid, _rel_type text, _strength_delta numeric, _metadata jsonb, _bidirectional boolean) TO service_role;

--
-- Name: FUNCTION upsert_social_connection(_brand_id uuid, _provider text, _channel text, _external_id text, _access_token_ciphertext text, _external_name text, _account_username text, _page_id text, _instagram_business_id text, _meta_user_id text, _owner_external_id text, _owner_name text, _scopes text[], _token_expires_at timestamp with time zone, _metadata jsonb, _created_by uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_social_connection(_brand_id uuid, _provider text, _channel text, _external_id text, _access_token_ciphertext text, _external_name text, _account_username text, _page_id text, _instagram_business_id text, _meta_user_id text, _owner_external_id text, _owner_name text, _scopes text[], _token_expires_at timestamp with time zone, _metadata jsonb, _created_by uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.upsert_social_connection(_brand_id uuid, _provider text, _channel text, _external_id text, _access_token_ciphertext text, _external_name text, _account_username text, _page_id text, _instagram_business_id text, _meta_user_id text, _owner_external_id text, _owner_name text, _scopes text[], _token_expires_at timestamp with time zone, _metadata jsonb, _created_by uuid) TO service_role;

--
-- Name: FUNCTION validate_client_social_account(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_client_social_account() FROM PUBLIC;

GRANT ALL ON FUNCTION public.validate_client_social_account() TO service_role;

--
-- Name: FUNCTION validate_placement_connection(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_placement_connection() FROM PUBLIC;

GRANT ALL ON FUNCTION public.validate_placement_connection() TO service_role;

--
-- Name: TABLE activity_events; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.activity_events TO anon;

GRANT ALL ON TABLE public.activity_events TO authenticated;

GRANT ALL ON TABLE public.activity_events TO service_role;

--
-- Name: TABLE agent_prompt_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.agent_prompt_overrides TO anon;

GRANT ALL ON TABLE public.agent_prompt_overrides TO authenticated;

GRANT ALL ON TABLE public.agent_prompt_overrides TO service_role;

--
-- Name: TABLE agent_prompts; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.agent_prompts TO anon;

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.agent_prompts TO authenticated;

GRANT ALL ON TABLE public.agent_prompts TO service_role;

--
-- Name: TABLE ai_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.ai_jobs TO anon;

GRANT ALL ON TABLE public.ai_jobs TO authenticated;

GRANT ALL ON TABLE public.ai_jobs TO service_role;

--
-- Name: TABLE ai_model_catalog_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.ai_model_catalog_overrides TO anon;

GRANT ALL ON TABLE public.ai_model_catalog_overrides TO authenticated;

GRANT ALL ON TABLE public.ai_model_catalog_overrides TO service_role;

--
-- Name: TABLE ai_model_health; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.ai_model_health TO anon;

GRANT ALL ON TABLE public.ai_model_health TO authenticated;

GRANT ALL ON TABLE public.ai_model_health TO service_role;

--
-- Name: TABLE ai_usage_limits; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.ai_usage_limits TO anon;

GRANT ALL ON TABLE public.ai_usage_limits TO authenticated;

GRANT ALL ON TABLE public.ai_usage_limits TO service_role;

--
-- Name: TABLE brain_embeddings; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_embeddings TO anon;

GRANT ALL ON TABLE public.brain_embeddings TO authenticated;

GRANT ALL ON TABLE public.brain_embeddings TO service_role;

--
-- Name: TABLE brain_events; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.brain_events TO anon;

GRANT ALL ON TABLE public.brain_events TO authenticated;

GRANT ALL ON TABLE public.brain_events TO service_role;

--
-- Name: TABLE brain_insights; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_insights TO anon;

GRANT ALL ON TABLE public.brain_insights TO authenticated;

GRANT ALL ON TABLE public.brain_insights TO service_role;

--
-- Name: TABLE brain_learning_queue; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_learning_queue TO anon;

GRANT ALL ON TABLE public.brain_learning_queue TO authenticated;

GRANT ALL ON TABLE public.brain_learning_queue TO service_role;

--
-- Name: TABLE brain_memory; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_memory TO anon;

GRANT ALL ON TABLE public.brain_memory TO authenticated;

GRANT ALL ON TABLE public.brain_memory TO service_role;

--
-- Name: TABLE brain_memory_versions; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_memory_versions TO anon;

GRANT ALL ON TABLE public.brain_memory_versions TO authenticated;

GRANT ALL ON TABLE public.brain_memory_versions TO service_role;

--
-- Name: TABLE brain_metrics_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_metrics_snapshots TO anon;

GRANT ALL ON TABLE public.brain_metrics_snapshots TO authenticated;

GRANT ALL ON TABLE public.brain_metrics_snapshots TO service_role;

--
-- Name: TABLE brain_reasoning_logs; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_reasoning_logs TO anon;

GRANT ALL ON TABLE public.brain_reasoning_logs TO authenticated;

GRANT ALL ON TABLE public.brain_reasoning_logs TO service_role;

--
-- Name: TABLE brain_recommendations; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_recommendations TO anon;

GRANT ALL ON TABLE public.brain_recommendations TO authenticated;

GRANT ALL ON TABLE public.brain_recommendations TO service_role;

--
-- Name: TABLE brain_relationships; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_relationships TO anon;

GRANT ALL ON TABLE public.brain_relationships TO authenticated;

GRANT ALL ON TABLE public.brain_relationships TO service_role;

--
-- Name: TABLE brain_retention_config; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_retention_config TO anon;

GRANT ALL ON TABLE public.brain_retention_config TO authenticated;

GRANT ALL ON TABLE public.brain_retention_config TO service_role;

--
-- Name: TABLE brands; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brands TO anon;

GRANT ALL ON TABLE public.brands TO authenticated;

GRANT ALL ON TABLE public.brands TO service_role;

--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.posts TO anon;

GRANT ALL ON TABLE public.posts TO authenticated;

GRANT ALL ON TABLE public.posts TO service_role;

--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.projects TO anon;

GRANT ALL ON TABLE public.projects TO authenticated;

GRANT ALL ON TABLE public.projects TO service_role;

--
-- Name: TABLE tasks; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.tasks TO anon;

GRANT ALL ON TABLE public.tasks TO authenticated;

GRANT ALL ON TABLE public.tasks TO service_role;

--
-- Name: TABLE brain_stats_mv; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.brain_stats_mv TO service_role;

--
-- Name: TABLE brain_worker_runs; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brain_worker_runs TO anon;

GRANT ALL ON TABLE public.brain_worker_runs TO authenticated;

GRANT ALL ON TABLE public.brain_worker_runs TO service_role;

--
-- Name: TABLE brand_ai_content; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_ai_content TO anon;

GRANT ALL ON TABLE public.brand_ai_content TO authenticated;

GRANT ALL ON TABLE public.brand_ai_content TO service_role;

--
-- Name: TABLE brand_ai_usage; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_ai_usage TO anon;

GRANT ALL ON TABLE public.brand_ai_usage TO authenticated;

GRANT ALL ON TABLE public.brand_ai_usage TO service_role;

--
-- Name: TABLE brand_ai_versions; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_ai_versions TO anon;

GRANT ALL ON TABLE public.brand_ai_versions TO authenticated;

GRANT ALL ON TABLE public.brand_ai_versions TO service_role;

--
-- Name: TABLE brand_api_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_api_credentials TO anon;

GRANT ALL ON TABLE public.brand_api_credentials TO authenticated;

GRANT ALL ON TABLE public.brand_api_credentials TO service_role;

--
-- Name: TABLE brand_briefing_proposals; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_briefing_proposals TO anon;

GRANT ALL ON TABLE public.brand_briefing_proposals TO authenticated;

GRANT ALL ON TABLE public.brand_briefing_proposals TO service_role;

--
-- Name: TABLE brand_briefing_requests; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_briefing_requests TO anon;

GRANT ALL ON TABLE public.brand_briefing_requests TO authenticated;

GRANT ALL ON TABLE public.brand_briefing_requests TO service_role;

--
-- Name: TABLE brand_briefing_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_briefing_reviews TO anon;

GRANT ALL ON TABLE public.brand_briefing_reviews TO authenticated;

GRANT ALL ON TABLE public.brand_briefing_reviews TO service_role;

--
-- Name: TABLE brand_briefing_versions; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_briefing_versions TO anon;

GRANT ALL ON TABLE public.brand_briefing_versions TO authenticated;

GRANT ALL ON TABLE public.brand_briefing_versions TO service_role;

--
-- Name: TABLE brand_briefings; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_briefings TO anon;

GRANT ALL ON TABLE public.brand_briefings TO authenticated;

GRANT ALL ON TABLE public.brand_briefings TO service_role;

--
-- Name: TABLE brand_cohorts; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_cohorts TO anon;

GRANT ALL ON TABLE public.brand_cohorts TO authenticated;

GRANT ALL ON TABLE public.brand_cohorts TO service_role;

--
-- Name: TABLE brand_competitors; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_competitors TO anon;

GRANT ALL ON TABLE public.brand_competitors TO authenticated;

GRANT ALL ON TABLE public.brand_competitors TO service_role;

--
-- Name: TABLE brand_connections; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_connections TO anon;

GRANT ALL ON TABLE public.brand_connections TO authenticated;

GRANT ALL ON TABLE public.brand_connections TO service_role;

--
-- Name: TABLE brand_features; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_features TO anon;

GRANT ALL ON TABLE public.brand_features TO authenticated;

GRANT ALL ON TABLE public.brand_features TO service_role;

--
-- Name: TABLE brand_invites; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_invites TO anon;

GRANT ALL ON TABLE public.brand_invites TO authenticated;

GRANT ALL ON TABLE public.brand_invites TO service_role;

--
-- Name: TABLE brand_journey_stage_templates; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_journey_stage_templates TO anon;

GRANT ALL ON TABLE public.brand_journey_stage_templates TO authenticated;

GRANT ALL ON TABLE public.brand_journey_stage_templates TO service_role;

--
-- Name: TABLE brand_media_assets; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_media_assets TO anon;

GRANT ALL ON TABLE public.brand_media_assets TO authenticated;

GRANT ALL ON TABLE public.brand_media_assets TO service_role;

--
-- Name: TABLE brand_members; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_members TO anon;

GRANT ALL ON TABLE public.brand_members TO authenticated;

GRANT ALL ON TABLE public.brand_members TO service_role;

--
-- Name: TABLE brand_pautas; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_pautas TO anon;

GRANT ALL ON TABLE public.brand_pautas TO authenticated;

GRANT ALL ON TABLE public.brand_pautas TO service_role;

--
-- Name: TABLE brand_personas; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_personas TO anon;

GRANT ALL ON TABLE public.brand_personas TO authenticated;

GRANT ALL ON TABLE public.brand_personas TO service_role;

--
-- Name: TABLE brand_swot; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_swot TO anon;

GRANT ALL ON TABLE public.brand_swot TO authenticated;

GRANT ALL ON TABLE public.brand_swot TO service_role;

--
-- Name: TABLE brand_voice_cards; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.brand_voice_cards TO anon;

GRANT ALL ON TABLE public.brand_voice_cards TO authenticated;

GRANT ALL ON TABLE public.brand_voice_cards TO service_role;

--
-- Name: TABLE calendar_events; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.calendar_events TO anon;

GRANT ALL ON TABLE public.calendar_events TO authenticated;

GRANT ALL ON TABLE public.calendar_events TO service_role;

--
-- Name: TABLE card_approval_events; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.card_approval_events TO anon;

GRANT ALL ON TABLE public.card_approval_events TO authenticated;

GRANT ALL ON TABLE public.card_approval_events TO service_role;

--
-- Name: TABLE card_approval_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.card_approval_tokens TO anon;

GRANT ALL ON TABLE public.card_approval_tokens TO authenticated;

GRANT ALL ON TABLE public.card_approval_tokens TO service_role;

--
-- Name: TABLE chat_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.chat_conversations TO anon;

GRANT ALL ON TABLE public.chat_conversations TO authenticated;

GRANT ALL ON TABLE public.chat_conversations TO service_role;

--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.chat_messages TO anon;

GRANT ALL ON TABLE public.chat_messages TO authenticated;

GRANT ALL ON TABLE public.chat_messages TO service_role;

--
-- Name: TABLE client_briefing_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.client_briefing_tokens TO anon;

GRANT ALL ON TABLE public.client_briefing_tokens TO authenticated;

GRANT ALL ON TABLE public.client_briefing_tokens TO service_role;

--
-- Name: TABLE client_briefings; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.client_briefings TO anon;

GRANT ALL ON TABLE public.client_briefings TO authenticated;

GRANT ALL ON TABLE public.client_briefings TO service_role;

--
-- Name: TABLE client_documents; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.client_documents TO anon;

GRANT ALL ON TABLE public.client_documents TO authenticated;

GRANT ALL ON TABLE public.client_documents TO service_role;

--
-- Name: TABLE client_journey_events; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.client_journey_events TO anon;

GRANT ALL ON TABLE public.client_journey_events TO authenticated;

GRANT ALL ON TABLE public.client_journey_events TO service_role;

--
-- Name: TABLE client_members; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.client_members TO anon;

GRANT ALL ON TABLE public.client_members TO authenticated;

GRANT ALL ON TABLE public.client_members TO service_role;

--
-- Name: TABLE client_social_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.client_social_accounts TO anon;

GRANT ALL ON TABLE public.client_social_accounts TO authenticated;

GRANT ALL ON TABLE public.client_social_accounts TO service_role;

--
-- Name: TABLE clients; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.clients TO anon;

GRANT ALL ON TABLE public.clients TO authenticated;

GRANT ALL ON TABLE public.clients TO service_role;

--
-- Name: TABLE content_pipeline_stages; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.content_pipeline_stages TO anon;

GRANT ALL ON TABLE public.content_pipeline_stages TO authenticated;

GRANT ALL ON TABLE public.content_pipeline_stages TO service_role;

--
-- Name: TABLE content_pipelines; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.content_pipelines TO anon;

GRANT ALL ON TABLE public.content_pipelines TO authenticated;

GRANT ALL ON TABLE public.content_pipelines TO service_role;

--
-- Name: TABLE evolution_events; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.evolution_events TO anon;

GRANT ALL ON TABLE public.evolution_events TO authenticated;

GRANT ALL ON TABLE public.evolution_events TO service_role;

--
-- Name: TABLE evolution_instances; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.evolution_instances TO anon;

GRANT ALL ON TABLE public.evolution_instances TO authenticated;

GRANT ALL ON TABLE public.evolution_instances TO service_role;

--
-- Name: TABLE feature_catalog; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.feature_catalog TO anon;

GRANT ALL ON TABLE public.feature_catalog TO authenticated;

GRANT ALL ON TABLE public.feature_catalog TO service_role;

--
-- Name: TABLE installation; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.installation TO anon;

GRANT ALL ON TABLE public.installation TO authenticated;

GRANT ALL ON TABLE public.installation TO service_role;

--
-- Name: TABLE media_plan_items; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.media_plan_items TO anon;

GRANT ALL ON TABLE public.media_plan_items TO authenticated;

GRANT ALL ON TABLE public.media_plan_items TO service_role;

--
-- Name: TABLE media_plans; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.media_plans TO anon;

GRANT ALL ON TABLE public.media_plans TO authenticated;

GRANT ALL ON TABLE public.media_plans TO service_role;

--
-- Name: TABLE message_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.message_logs TO authenticated;

GRANT ALL ON TABLE public.message_logs TO service_role;

--
-- Name: TABLE message_templates; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.message_templates TO anon;

GRANT ALL ON TABLE public.message_templates TO authenticated;

GRANT ALL ON TABLE public.message_templates TO service_role;

--
-- Name: TABLE meta_compliance_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meta_compliance_events TO service_role;

--
-- Name: TABLE meta_oauth_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.meta_oauth_sessions TO anon;

GRANT ALL ON TABLE public.meta_oauth_sessions TO authenticated;

GRANT ALL ON TABLE public.meta_oauth_sessions TO service_role;

--
-- Name: TABLE monthly_plan_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.monthly_plan_tokens TO anon;

GRANT ALL ON TABLE public.monthly_plan_tokens TO authenticated;

GRANT ALL ON TABLE public.monthly_plan_tokens TO service_role;

--
-- Name: TABLE monthly_plan_topics; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.monthly_plan_topics TO anon;

GRANT ALL ON TABLE public.monthly_plan_topics TO authenticated;

GRANT ALL ON TABLE public.monthly_plan_topics TO service_role;

--
-- Name: TABLE monthly_plans; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.monthly_plans TO anon;

GRANT ALL ON TABLE public.monthly_plans TO authenticated;

GRANT ALL ON TABLE public.monthly_plans TO service_role;

--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.notifications TO anon;

GRANT ALL ON TABLE public.notifications TO authenticated;

GRANT ALL ON TABLE public.notifications TO service_role;

--
-- Name: TABLE plan_overage_requests; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.plan_overage_requests TO anon;

GRANT ALL ON TABLE public.plan_overage_requests TO authenticated;

GRANT ALL ON TABLE public.plan_overage_requests TO service_role;

--
-- Name: TABLE portal_rate_limit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.portal_rate_limit TO service_role;

--
-- Name: TABLE portal_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.portal_tokens TO anon;

GRANT ALL ON TABLE public.portal_tokens TO authenticated;

GRANT ALL ON TABLE public.portal_tokens TO service_role;

--
-- Name: TABLE post_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.post_approvals TO anon;

GRANT ALL ON TABLE public.post_approvals TO authenticated;

GRANT ALL ON TABLE public.post_approvals TO service_role;

--
-- Name: TABLE post_placements; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.post_placements TO anon;

GRANT ALL ON TABLE public.post_placements TO authenticated;

GRANT ALL ON TABLE public.post_placements TO service_role;

--
-- Name: TABLE project_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.project_jobs TO anon;

GRANT ALL ON TABLE public.project_jobs TO authenticated;

GRANT ALL ON TABLE public.project_jobs TO service_role;

--
-- Name: TABLE project_template_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.project_template_jobs TO anon;

GRANT ALL ON TABLE public.project_template_jobs TO authenticated;

GRANT ALL ON TABLE public.project_template_jobs TO service_role;

--
-- Name: TABLE project_template_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.project_template_tasks TO anon;

GRANT ALL ON TABLE public.project_template_tasks TO authenticated;

GRANT ALL ON TABLE public.project_template_tasks TO service_role;

--
-- Name: TABLE project_templates; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.project_templates TO anon;

GRANT ALL ON TABLE public.project_templates TO authenticated;

GRANT ALL ON TABLE public.project_templates TO service_role;

--
-- Name: TABLE sla_rules; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.sla_rules TO anon;

GRANT ALL ON TABLE public.sla_rules TO authenticated;

GRANT ALL ON TABLE public.sla_rules TO service_role;

--
-- Name: TABLE social_connections; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.social_connections TO anon;

GRANT ALL ON TABLE public.social_connections TO authenticated;

GRANT ALL ON TABLE public.social_connections TO service_role;

--
-- Name: TABLE social_posts; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.social_posts TO anon;

GRANT ALL ON TABLE public.social_posts TO authenticated;

GRANT ALL ON TABLE public.social_posts TO service_role;

--
-- Name: TABLE task_comments; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.task_comments TO anon;

GRANT ALL ON TABLE public.task_comments TO authenticated;

GRANT ALL ON TABLE public.task_comments TO service_role;

--
-- Name: TABLE task_subtasks; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.task_subtasks TO anon;

GRANT ALL ON TABLE public.task_subtasks TO authenticated;

GRANT ALL ON TABLE public.task_subtasks TO service_role;

--
-- Name: TABLE task_time_entries; Type: ACL; Schema: public; Owner: -
--

GRANT MAINTAIN ON TABLE public.task_time_entries TO anon;

GRANT ALL ON TABLE public.task_time_entries TO authenticated;

GRANT ALL ON TABLE public.task_time_entries TO service_role;

--
-- Name: TABLE user_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_profiles TO authenticated;

GRANT ALL ON TABLE public.user_profiles TO service_role;

--
-- Name: TABLE whatsapp_recipients; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.whatsapp_recipients TO anon;

GRANT ALL ON TABLE public.whatsapp_recipients TO authenticated;

GRANT ALL ON TABLE public.whatsapp_recipients TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


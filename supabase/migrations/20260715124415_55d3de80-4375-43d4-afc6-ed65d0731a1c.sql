
create extension if not exists vector;

-- ===== brain_events =====
create table public.brain_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete cascade,
  event_type text not null,
  source_module text not null,
  payload jsonb not null default '{}'::jsonb,
  outcome_score numeric,
  created_at timestamptz not null default now()
);
create index brain_events_brand_created_idx on public.brain_events (brand_id, created_at desc);
create index brain_events_type_idx on public.brain_events (event_type);
create index brain_events_source_idx on public.brain_events (source_module);

grant select, insert on public.brain_events to authenticated;
grant all on public.brain_events to service_role;
alter table public.brain_events enable row level security;

create policy "brain_events select by brand or super admin"
  on public.brain_events for select to authenticated
  using (
    public.is_super_admin(auth.uid())
    or (brand_id is not null and public.is_brand_member(brand_id, auth.uid()))
  );

create policy "brain_events insert by brand member"
  on public.brain_events for insert to authenticated
  with check (
    brand_id is not null and public.is_brand_member(brand_id, auth.uid())
  );

-- ===== brain_embeddings =====
create table public.brain_embeddings (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete cascade,
  event_id uuid references public.brain_events(id) on delete cascade,
  content_summary text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index brain_embeddings_brand_idx on public.brain_embeddings (brand_id);
create index brain_embeddings_event_idx on public.brain_embeddings (event_id);
create index brain_embeddings_hnsw_idx
  on public.brain_embeddings using hnsw (embedding vector_cosine_ops);

grant select on public.brain_embeddings to authenticated;
grant all on public.brain_embeddings to service_role;
alter table public.brain_embeddings enable row level security;

create policy "brain_embeddings select by brand or super admin"
  on public.brain_embeddings for select to authenticated
  using (
    public.is_super_admin(auth.uid())
    or (brand_id is not null and public.is_brand_member(brand_id, auth.uid()))
  );

-- ===== brain_insights =====
create table public.brain_insights (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete cascade,
  insight_type text not null,
  description text not null,
  confidence numeric,
  based_on_events int default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index brain_insights_brand_idx on public.brain_insights (brand_id, created_at desc);

grant select on public.brain_insights to authenticated;
grant all on public.brain_insights to service_role;
alter table public.brain_insights enable row level security;

create policy "brain_insights select by brand, agency-wide, or super admin"
  on public.brain_insights for select to authenticated
  using (
    brand_id is null
    or public.is_super_admin(auth.uid())
    or public.is_brand_member(brand_id, auth.uid())
  );
-- Insights são gravados apenas pelo processo de consolidação (service role).

-- ===== brain_metrics_snapshots =====
create table public.brain_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete cascade,
  channel text,
  metric_name text not null,
  metric_value numeric not null,
  period_start date not null,
  period_end date not null,
  created_at timestamptz not null default now()
);
create index brain_metrics_brand_idx on public.brain_metrics_snapshots (brand_id, period_end desc);

grant select on public.brain_metrics_snapshots to authenticated;
grant all on public.brain_metrics_snapshots to service_role;
alter table public.brain_metrics_snapshots enable row level security;

create policy "brain_metrics select by brand or super admin"
  on public.brain_metrics_snapshots for select to authenticated
  using (
    public.is_super_admin(auth.uid())
    or (brand_id is not null and public.is_brand_member(brand_id, auth.uid()))
  );

-- ===== Similarity search function =====
create or replace function public.match_brain_events(
  _brand_id uuid,
  _query vector(1536),
  _match_count int default 8
)
returns table (
  event_id uuid,
  content_summary text,
  event_type text,
  source_module text,
  payload jsonb,
  created_at timestamptz,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
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
      or public.is_brand_member(_brand_id, auth.uid())
    )
  order by em.embedding <=> _query
  limit _match_count;
$$;

revoke execute on function public.match_brain_events(uuid, vector, int) from public, anon;
grant execute on function public.match_brain_events(uuid, vector, int) to authenticated, service_role;

-- ===== agent_prompts.brain_enabled =====
alter table public.agent_prompts
  add column if not exists brain_enabled boolean not null default true;

-- ===== realtime =====
alter publication supabase_realtime add table public.brain_events;
alter publication supabase_realtime add table public.brain_insights;

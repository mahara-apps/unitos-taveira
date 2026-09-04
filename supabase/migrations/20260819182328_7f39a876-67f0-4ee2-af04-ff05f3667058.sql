
-- FASE A: backfill de responsáveis
update public.clients c
set owner_user_id = sub.user_id
from (
  select distinct on (bm.brand_id) bm.brand_id, bm.user_id
  from public.brand_members bm
  where bm.role = 'owner' and coalesce(bm.is_active, true)
  order by bm.brand_id, bm.created_at asc
) sub
where c.owner_user_id is null and c.brand_id = sub.brand_id;

create or replace function public.clients_set_default_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists trg_clients_set_default_owner on public.clients;
create trigger trg_clients_set_default_owner
before insert on public.clients
for each row execute function public.clients_set_default_owner();

-- FASE B1: helper que aplica grants/policies numa partição de brain_events
create or replace function public.brain_apply_partition_policies(_part_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_class where relname = _part_name) then
    return;
  end if;
  execute format('alter table public.%I enable row level security', _part_name);
  execute format('alter table public.%I force row level security', _part_name);
  execute format('grant select, insert on public.%I to authenticated', _part_name);
  execute format('grant all on public.%I to service_role', _part_name);
  if not exists (select 1 from pg_policies where schemaname='public' and tablename=_part_name and policyname='brain_events_part_select') then
    execute format($f$create policy "brain_events_part_select" on public.%I for select to authenticated
      using (public.is_super_admin(auth.uid()) or (brand_id is not null and public.is_brand_member(brand_id, auth.uid())))$f$, _part_name);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename=_part_name and policyname='brain_events_part_insert') then
    execute format($f$create policy "brain_events_part_insert" on public.%I for insert to authenticated
      with check (brand_id is not null and public.is_brand_member(brand_id, auth.uid()))$f$, _part_name);
  end if;
end;
$$;

do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relispartition
      and c.relname like 'brain\_events\_%'
  loop
    perform public.brain_apply_partition_policies(r.relname);
  end loop;
end $$;

create or replace function public.brain_ensure_event_partitions(_months_back integer default 3, _months_forward integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
DECLARE i int; s date; e date; part_name text; created int := 0;
BEGIN
  FOR i IN -_months_back .. _months_forward LOOP
    s := (date_trunc('month', now()) + (i || ' months')::interval)::date;
    e := (s + interval '1 month')::date;
    part_name := format('brain_events_%s', to_char(s, 'YYYYMM'));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.brain_events FOR VALUES FROM (%L) TO (%L)',
        part_name, s, e);
      created := created + 1;
    END IF;
    PERFORM public.brain_apply_partition_policies(part_name);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'brain_events_default') THEN
    EXECUTE 'CREATE TABLE public.brain_events_default PARTITION OF public.brain_events DEFAULT';
    created := created + 1;
  END IF;
  PERFORM public.brain_apply_partition_policies('brain_events_default');
  RETURN created;
END
$$;

-- FASE B2: tabelas internas restritas ao servidor
revoke all on public.portal_rate_limit from authenticated, anon;
revoke all on public.meta_compliance_events from authenticated, anon;
grant all on public.portal_rate_limit to service_role;
grant all on public.meta_compliance_events to service_role;
alter table public.meta_compliance_events enable row level security;
comment on table public.portal_rate_limit is 'Uso interno (service role). RLS sem policies nega acesso via Data API.';
comment on table public.meta_compliance_events is 'Uso interno (service role). RLS sem policies nega acesso via Data API.';

-- FASE B3: restringir papéis graváveis aos oficiais
alter table public.brand_members drop constraint if exists brand_members_role_official_chk;
alter table public.brand_members add constraint brand_members_role_official_chk
  check (role in ('owner','manager','user','client')) not valid;
alter table public.brand_members validate constraint brand_members_role_official_chk;

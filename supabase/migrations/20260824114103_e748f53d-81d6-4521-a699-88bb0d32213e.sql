-- ============================================================
-- Fase 1 RBAC — Brain client-scoped
-- ============================================================

DO $do$
DECLARE
  v_part text;
BEGIN
  FOREACH v_part IN ARRAY ARRAY[
    'brain_events','brain_events_default','brain_events_202605','brain_events_202606',
    'brain_events_202607','brain_events_202608','brain_events_202609','brain_events_202610',
    'brain_events_202611'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = v_part) THEN
      EXECUTE format('DROP POLICY IF EXISTS "brain_events_part_select" ON public.%I', v_part);
      EXECUTE format('DROP POLICY IF EXISTS "brain_events_part_insert" ON public.%I', v_part);
      EXECUTE format('DROP POLICY IF EXISTS "brain_events select by brand or super admin" ON public.%I', v_part);
      EXECUTE format('DROP POLICY IF EXISTS "brain_events insert by brand member" ON public.%I', v_part);
      EXECUTE format($f$CREATE POLICY "brain_events_part_select" ON public.%I FOR SELECT TO authenticated
        USING (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id))$f$, v_part);
      EXECUTE format($f$CREATE POLICY "brain_events_part_insert" ON public.%I FOR INSERT TO authenticated
        WITH CHECK (public.client_in_scope(client_id, brand_id))$f$, v_part);
    END IF;
  END LOOP;
END
$do$;

-- Novas partições nascem com a regra por cliente.
CREATE OR REPLACE FUNCTION public.brain_apply_partition_policies(_part_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      using (public.is_super_admin(auth.uid()) or public.client_in_scope(client_id, brand_id))$f$, _part_name);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename=_part_name and policyname='brain_events_part_insert') then
    execute format($f$create policy "brain_events_part_insert" on public.%I for insert to authenticated
      with check (public.client_in_scope(client_id, brand_id))$f$, _part_name);
  end if;
end;
$function$;

-- brain_events_archive --------------------------------------------
DROP POLICY IF EXISTS "brain_events_archive select by brand or super admin" ON public.brain_events_archive;
CREATE POLICY "brain_events_archive select in client scope" ON public.brain_events_archive
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));

-- brain_memory ----------------------------------------------------
DROP POLICY IF EXISTS "brain_memory select by brand or super admin" ON public.brain_memory;
CREATE POLICY "brain_memory select in client scope" ON public.brain_memory
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));

-- brain_insights (brand_id NULL = insight de agência) -------------
DROP POLICY IF EXISTS "brain_insights select by brand, agency-wide, or super admin" ON public.brain_insights;
CREATE POLICY "brain_insights select in client scope" ON public.brain_insights
  FOR SELECT TO authenticated
  USING (brand_id IS NULL OR public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));

-- brain_recommendations -------------------------------------------
DROP POLICY IF EXISTS "brain_recommendations select by brand or super admin" ON public.brain_recommendations;
CREATE POLICY "brain_recommendations select in client scope" ON public.brain_recommendations
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));

-- brain_relationships ---------------------------------------------
DROP POLICY IF EXISTS "brain_relationships select by brand or super admin" ON public.brain_relationships;
CREATE POLICY "brain_relationships select in client scope" ON public.brain_relationships
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));
-- FASE 10E.2 — hardening mínimo de brain_events (actor_id / created_at / payload)
-- Não altera dados históricos. Reutiliza apenas auth.uid()/auth.role().

CREATE OR REPLACE FUNCTION public.brain_events_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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
BEGIN
  -- Escritas de service_role / workers legítimos (sem sessão de usuário) mantêm
  -- a capacidade de registrar eventos de sistema com ator próprio e timestamp próprio.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Usuário autenticado: identidade e timestamp são autoritativos do servidor.
  NEW.actor_id := _uid;
  NEW.created_at := now();

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

DROP TRIGGER IF EXISTS trg_brain_events_guard_identity ON public.brain_events;
CREATE TRIGGER trg_brain_events_guard_identity
  BEFORE INSERT ON public.brain_events
  FOR EACH ROW EXECUTE FUNCTION public.brain_events_guard_identity();

-- Defesa em profundidade na policy: authenticated não pode declarar outro ator.
DROP POLICY IF EXISTS brain_events_part_insert ON public.brain_events;
CREATE POLICY brain_events_part_insert ON public.brain_events
  FOR INSERT TO authenticated
  WITH CHECK (
    client_in_scope(client_id, brand_id)
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

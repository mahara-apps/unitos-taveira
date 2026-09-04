-- FASE 10E.2 (ajuste) — pair check estrutural + created_at autoritativo via policy.
CREATE OR REPLACE FUNCTION public.brain_events_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.brain_events_guard_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.brain_events_guard_identity() FROM anon, authenticated;

-- created_at não pode ser falsificado por usuário autenticado (BEFORE trigger não pode
-- reescrever a coluna de particionamento). Janela curta ancorada em now().
DROP POLICY IF EXISTS brain_events_part_insert ON public.brain_events;
CREATE POLICY brain_events_part_insert ON public.brain_events
  FOR INSERT TO authenticated
  WITH CHECK (
    client_in_scope(client_id, brand_id)
    AND (actor_id IS NULL OR actor_id = auth.uid())
    AND created_at >= now() - interval '2 minutes'
    AND created_at <= now() + interval '2 minutes'
  );

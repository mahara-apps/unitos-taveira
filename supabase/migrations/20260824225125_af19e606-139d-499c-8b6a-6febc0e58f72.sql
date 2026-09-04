-- FASE 10B — Isolamento client-scoped de public.message_logs
-- 1) Vínculo opcional com cliente (client_id NULL = recurso de workspace; regra
--    definitiva de NULL será tratada na Fase 10C — aqui NULL não vaza).
ALTER TABLE public.message_logs
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS message_logs_client_sent_at_idx
  ON public.message_logs (client_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS message_logs_brand_client_idx
  ON public.message_logs (brand_id, client_id);

-- 2) Guard de integridade: o client_id precisa pertencer ao brand_id da linha.
--    Impede pares cross-workspace forjados independentemente do caller.
CREATE OR REPLACE FUNCTION public.message_logs_guard_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS message_logs_guard_scope_trg ON public.message_logs;
CREATE TRIGGER message_logs_guard_scope_trg
  BEFORE INSERT OR UPDATE ON public.message_logs
  FOR EACH ROW EXECUTE FUNCTION public.message_logs_guard_scope();

-- 3) Policies canônicas (substituem as baseadas apenas em is_brand_member).
DROP POLICY IF EXISTS "brand members can read message logs" ON public.message_logs;
DROP POLICY IF EXISTS "brand members can insert message logs" ON public.message_logs;
DROP POLICY IF EXISTS message_logs_scoped_select ON public.message_logs;
DROP POLICY IF EXISTS message_logs_scoped_insert ON public.message_logs;

CREATE POLICY message_logs_scoped_select
  ON public.message_logs FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (
      client_id IS NOT NULL
      AND public.client_in_scope(client_id, brand_id)
    )
    OR (
      -- Registros sem cliente = escopo de workspace: apenas autoridade total.
      client_id IS NULL
      AND public.is_brand_member(brand_id, auth.uid())
      AND public.app_access_role(auth.uid(), brand_id) = 'admin'
    )
  );

CREATE POLICY message_logs_scoped_insert
  ON public.message_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (
      client_id IS NOT NULL
      AND public.client_in_scope(client_id, brand_id)
    )
    OR (
      client_id IS NULL
      AND public.is_brand_member(brand_id, auth.uid())
      AND public.app_access_role(auth.uid(), brand_id) = 'admin'
    )
  );

-- 4) Privilégios: sem UPDATE/DELETE para usuários (não havia policy = já negado).
REVOKE UPDATE, DELETE ON public.message_logs FROM authenticated;
REVOKE ALL ON public.message_logs FROM anon;
GRANT SELECT, INSERT ON public.message_logs TO authenticated;
GRANT ALL ON public.message_logs TO service_role;

COMMENT ON COLUMN public.message_logs.client_id IS
  'Fase 10B: cliente do registro. NULL = registro de workspace (visível só para admin/super admin).';
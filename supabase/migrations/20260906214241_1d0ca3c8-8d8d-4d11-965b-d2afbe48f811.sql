-- Regras por cliente: aprovação do cliente por etapa + política de limite de produção.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS approval_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS approval_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clients.approval_policy IS
  'Etapas que exigem aprovação do cliente: {plan|content|schedule: "client"|"internal"}. Vazio herda do workspace; workspace vazio = comportamento histórico (cliente aprova).';
COMMENT ON COLUMN public.clients.scope_policy IS
  'Limite de produção: {"mode":"warn"|"block","applies":["ai","manual"]}. Vazio herda do workspace e depois de overage_policy.';

-- Autoridade: só Owner/Admin do workspace (ou Super Admin) muda essas regras.
CREATE OR REPLACE FUNCTION public.guard_client_policy_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _brand uuid;
  _role text;
BEGIN
  IF NEW.approval_policy IS DISTINCT FROM OLD.approval_policy
     OR NEW.scope_policy IS DISTINCT FROM OLD.scope_policy THEN
    -- Automação/serviço (sem usuário autenticado) segue permitido.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;
    _brand := CASE WHEN TG_TABLE_NAME = 'brands' THEN NEW.id ELSE NEW.brand_id END;
    _role := public.app_access_role(auth.uid(), _brand);
    IF _role IS NULL OR _role NOT IN ('super_admin', 'admin') THEN
      RAISE EXCEPTION 'client_policy_forbidden';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_clients_policy_authority ON public.clients;
CREATE TRIGGER guard_clients_policy_authority
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_policy_authority();

DROP TRIGGER IF EXISTS guard_brands_policy_authority ON public.brands;
CREATE TRIGGER guard_brands_policy_authority
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_policy_authority();
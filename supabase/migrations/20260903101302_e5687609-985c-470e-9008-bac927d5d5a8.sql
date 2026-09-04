CREATE OR REPLACE FUNCTION public.enforce_single_brand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rotinas internas (instalação/bootstrap e testes automatizados) rodam com a
  -- credencial de serviço e ficam fora da barreira; toda a aplicação (anon /
  -- authenticated) segue limitada a um único workspace por instalação.
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.brands WHERE id <> NEW.id) THEN
    RAISE EXCEPTION 'single_workspace_per_installation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_single_brand() FROM PUBLIC, anon, authenticated;
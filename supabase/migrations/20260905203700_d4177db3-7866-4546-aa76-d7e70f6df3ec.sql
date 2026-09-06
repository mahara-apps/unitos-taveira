-- 1) Limpeza: contatos de portal que ganharam vínculo de equipe por engano.
DELETE FROM public.brand_members bm
WHERE EXISTS (
  SELECT 1 FROM public.client_members cm
  WHERE cm.user_id = bm.user_id AND cm.role = 'portal_client'
);

-- 2) Trava: contato de portal nunca entra em brand_members.
CREATE OR REPLACE FUNCTION public.block_portal_client_team_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.client_members cm
    WHERE cm.user_id = NEW.user_id AND cm.role = 'portal_client'
  ) THEN
    RAISE EXCEPTION 'portal_client_cannot_be_team_member: conta de contato do portal não pode ter vínculo de equipe'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_portal_client_team_link ON public.brand_members;
CREATE TRIGGER trg_block_portal_client_team_link
BEFORE INSERT OR UPDATE OF user_id ON public.brand_members
FOR EACH ROW EXECUTE FUNCTION public.block_portal_client_team_link();

-- 3) Trava simétrica: virar contato de portal remove/impede vínculo de equipe.
CREATE OR REPLACE FUNCTION public.enforce_portal_client_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'portal_client' THEN
    DELETE FROM public.brand_members WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_portal_client_exclusivity ON public.client_members;
CREATE TRIGGER trg_enforce_portal_client_exclusivity
BEFORE INSERT OR UPDATE OF role, user_id ON public.client_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_client_exclusivity();
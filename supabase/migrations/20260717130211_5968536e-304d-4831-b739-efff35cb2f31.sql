
-- 1. Tabela client_members
CREATE TABLE IF NOT EXISTS public.client_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'editor',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (client_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_members TO authenticated;
GRANT ALL ON public.client_members TO service_role;

ALTER TABLE public.client_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS client_members_user_id_idx ON public.client_members(user_id);
CREATE INDEX IF NOT EXISTS client_members_brand_id_idx ON public.client_members(brand_id);

CREATE POLICY "read own client memberships"
  ON public.client_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = client_members.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner','manager')
    )
  );

CREATE POLICY "owners/managers manage client memberships"
  ON public.client_members FOR ALL
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = client_members.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner','manager')
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = client_members.brand_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner','manager')
    )
  );

-- 2. Helper: can_access_client
-- Regras:
--   super_admin => sempre
--   Se existe qualquer linha em client_members(client_id) => só entra quem estiver listado
--   Se NÃO existe nenhuma linha => qualquer brand_member da marca do cliente
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid;
  v_scoped boolean;
BEGIN
  IF _client_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin(_user_id) THEN
    RETURN true;
  END IF;

  SELECT brand_id INTO v_brand FROM public.clients WHERE id = _client_id;
  IF v_brand IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.client_members WHERE client_id = _client_id) INTO v_scoped;

  IF v_scoped THEN
    RETURN EXISTS (
      SELECT 1 FROM public.client_members
      WHERE client_id = _client_id AND user_id = _user_id
    );
  END IF;

  -- Sem restrição: qualquer membro da marca
  RETURN public.is_brand_member(v_brand, _user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_client(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid, uuid) TO service_role;

-- 3. Reescrever policies das tabelas escopadas por cliente
-- clients (só a SELECT/UPDATE precisa de filtro por cliente; INSERT/DELETE continua com brand_members owner/manager)
DROP POLICY IF EXISTS "brand members read clients" ON public.clients;
CREATE POLICY "brand members read clients"
  ON public.clients FOR SELECT
  USING (public.can_access_client(id, auth.uid()));

-- posts
DROP POLICY IF EXISTS "brand members manage posts" ON public.posts;
CREATE POLICY "brand members manage posts"
  ON public.posts FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- post_placements
DROP POLICY IF EXISTS "brand members manage placements" ON public.post_placements;
CREATE POLICY "brand members manage placements"
  ON public.post_placements FOR ALL
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_placements.post_id AND public.can_access_client(p.client_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_placements.post_id AND public.can_access_client(p.client_id, auth.uid())));

-- post_approvals
DROP POLICY IF EXISTS "brand members manage approvals" ON public.post_approvals;
CREATE POLICY "brand members manage approvals"
  ON public.post_approvals FOR ALL
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_approvals.post_id AND public.can_access_client(p.client_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_approvals.post_id AND public.can_access_client(p.client_id, auth.uid())));

-- tasks
DROP POLICY IF EXISTS "brand members manage tasks" ON public.tasks;
CREATE POLICY "brand members manage tasks"
  ON public.tasks FOR ALL
  USING (
    CASE WHEN client_id IS NULL
      THEN public.is_brand_member(brand_id, auth.uid())
      ELSE public.can_access_client(client_id, auth.uid())
    END
  )
  WITH CHECK (
    CASE WHEN client_id IS NULL
      THEN public.is_brand_member(brand_id, auth.uid())
      ELSE public.can_access_client(client_id, auth.uid())
    END
  );

-- projects
DROP POLICY IF EXISTS "brand members manage projects" ON public.projects;
CREATE POLICY "brand members manage projects"
  ON public.projects FOR ALL
  USING (
    CASE WHEN client_id IS NULL
      THEN public.is_brand_member(brand_id, auth.uid())
      ELSE public.can_access_client(client_id, auth.uid())
    END
  )
  WITH CHECK (
    CASE WHEN client_id IS NULL
      THEN public.is_brand_member(brand_id, auth.uid())
      ELSE public.can_access_client(client_id, auth.uid())
    END
  );

-- brand_briefings
DROP POLICY IF EXISTS "brand members access briefings" ON public.brand_briefings;
CREATE POLICY "brand members access briefings"
  ON public.brand_briefings FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- brand_ai_content
DROP POLICY IF EXISTS "brand members access ai content" ON public.brand_ai_content;
CREATE POLICY "brand members access ai content"
  ON public.brand_ai_content FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- brand_ai_versions
DROP POLICY IF EXISTS "brand members read versions" ON public.brand_ai_versions;
DROP POLICY IF EXISTS "brand members insert versions" ON public.brand_ai_versions;
CREATE POLICY "brand members read versions"
  ON public.brand_ai_versions FOR SELECT
  USING (public.can_access_client(client_id, auth.uid()));
CREATE POLICY "brand members insert versions"
  ON public.brand_ai_versions FOR INSERT
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- brand_personas
DROP POLICY IF EXISTS "brand members access personas" ON public.brand_personas;
CREATE POLICY "brand members access personas"
  ON public.brand_personas FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- brand_swot
DROP POLICY IF EXISTS "brand members access swot" ON public.brand_swot;
CREATE POLICY "brand members access swot"
  ON public.brand_swot FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- brand_competitors
DROP POLICY IF EXISTS "brand members access competitors" ON public.brand_competitors;
CREATE POLICY "brand members access competitors"
  ON public.brand_competitors FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- brand_pautas
DROP POLICY IF EXISTS "brand members access pautas" ON public.brand_pautas;
CREATE POLICY "brand members access pautas"
  ON public.brand_pautas FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- brand_voice_cards
DROP POLICY IF EXISTS "brand members access voice cards" ON public.brand_voice_cards;
CREATE POLICY "brand members access voice cards"
  ON public.brand_voice_cards FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- client_briefings
DROP POLICY IF EXISTS "brand members manage briefings" ON public.client_briefings;
CREATE POLICY "brand members manage briefings"
  ON public.client_briefings FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- client_briefing_tokens
DROP POLICY IF EXISTS "brand members manage briefing tokens" ON public.client_briefing_tokens;
CREATE POLICY "brand members manage briefing tokens"
  ON public.client_briefing_tokens FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- media_plans
DROP POLICY IF EXISTS "brand members manage media plans" ON public.media_plans;
CREATE POLICY "brand members manage media plans"
  ON public.media_plans FOR ALL
  USING (public.can_access_client(client_id, auth.uid()))
  WITH CHECK (public.can_access_client(client_id, auth.uid()));

-- media_plan_items
DROP POLICY IF EXISTS "brand members manage media plan items" ON public.media_plan_items;
CREATE POLICY "brand members manage media plan items"
  ON public.media_plan_items FOR ALL
  USING (EXISTS (SELECT 1 FROM public.media_plans mp WHERE mp.id = media_plan_items.plan_id AND public.can_access_client(mp.client_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.media_plans mp WHERE mp.id = media_plan_items.plan_id AND public.can_access_client(mp.client_id, auth.uid())));

-- activity_events (mantém tolerante quando client_id é null)
DROP POLICY IF EXISTS "brand members read activity" ON public.activity_events;
CREATE POLICY "brand members read activity"
  ON public.activity_events FOR SELECT
  USING (
    CASE WHEN client_id IS NULL
      THEN public.is_brand_member(brand_id, auth.uid())
      ELSE public.can_access_client(client_id, auth.uid())
    END
  );

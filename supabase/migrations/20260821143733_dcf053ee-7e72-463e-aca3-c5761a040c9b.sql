-- social_connections
DROP POLICY IF EXISTS "social_connections brand members read" ON public.social_connections;
CREATE POLICY "social_connections brand members read" ON public.social_connections FOR SELECT TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));
DROP POLICY IF EXISTS "social_connections admins insert" ON public.social_connections;
CREATE POLICY "social_connections admins insert" ON public.social_connections FOR INSERT TO authenticated
WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));
DROP POLICY IF EXISTS "social_connections admins update" ON public.social_connections;
CREATE POLICY "social_connections admins update" ON public.social_connections FOR UPDATE TO authenticated
USING (public.is_brand_admin_level(brand_id, auth.uid()))
WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));
DROP POLICY IF EXISTS "social_connections admins delete" ON public.social_connections;
CREATE POLICY "social_connections admins delete" ON public.social_connections FOR DELETE TO authenticated
USING (public.is_brand_admin_level(brand_id, auth.uid()));

-- client_social_accounts
DROP POLICY IF EXISTS "csa brand members read" ON public.client_social_accounts;
CREATE POLICY "csa brand members read" ON public.client_social_accounts FOR SELECT TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));
DROP POLICY IF EXISTS "csa admins insert" ON public.client_social_accounts;
CREATE POLICY "csa admins insert" ON public.client_social_accounts FOR INSERT TO authenticated
WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));
DROP POLICY IF EXISTS "csa admins update" ON public.client_social_accounts;
CREATE POLICY "csa admins update" ON public.client_social_accounts FOR UPDATE TO authenticated
USING (public.is_brand_admin_level(brand_id, auth.uid()))
WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));
DROP POLICY IF EXISTS "csa admins delete" ON public.client_social_accounts;
CREATE POLICY "csa admins delete" ON public.client_social_accounts FOR DELETE TO authenticated
USING (public.is_brand_admin_level(brand_id, auth.uid()));

-- social_posts
DROP POLICY IF EXISTS "social_posts brand members read" ON public.social_posts;
CREATE POLICY "social_posts brand members read" ON public.social_posts FOR SELECT TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));
DROP POLICY IF EXISTS "social_posts brand members insert" ON public.social_posts;
CREATE POLICY "social_posts brand members insert" ON public.social_posts FOR INSERT TO authenticated
WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
DROP POLICY IF EXISTS "social_posts brand members update" ON public.social_posts;
CREATE POLICY "social_posts brand members update" ON public.social_posts FOR UPDATE TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));
DROP POLICY IF EXISTS "social_posts brand members delete" ON public.social_posts;
CREATE POLICY "social_posts brand members delete" ON public.social_posts FOR DELETE TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));

-- sla_rules
DROP POLICY IF EXISTS "sla_rules_read_members" ON public.sla_rules;
CREATE POLICY "sla_rules_read_members" ON public.sla_rules FOR SELECT TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));
DROP POLICY IF EXISTS "sla_rules_write_managers" ON public.sla_rules;
CREATE POLICY "sla_rules_write_managers" ON public.sla_rules FOR ALL TO authenticated
USING (public.is_brand_admin_level(brand_id, auth.uid()))
WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));

-- client_members
DROP POLICY IF EXISTS "owners/managers manage client memberships" ON public.client_members;
CREATE POLICY "owners/managers manage client memberships" ON public.client_members FOR ALL TO authenticated
USING (public.is_brand_admin_level(brand_id, auth.uid()))
WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));
DROP POLICY IF EXISTS "read own client memberships" ON public.client_members;
CREATE POLICY "read own client memberships" ON public.client_members FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_brand_admin_level(brand_id, auth.uid()));

-- monthly_plan_topics
DROP POLICY IF EXISTS "Brand members can read monthly_plan_topics" ON public.monthly_plan_topics;
CREATE POLICY "Brand members can read monthly_plan_topics" ON public.monthly_plan_topics FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.monthly_plans mp
  WHERE mp.id = monthly_plan_topics.monthly_plan_id
    AND public.is_brand_member(mp.brand_id, auth.uid())
));

-- client_journey_events
DROP POLICY IF EXISTS "journey_events_select_brand_members" ON public.client_journey_events;
CREATE POLICY "journey_events_select_brand_members" ON public.client_journey_events FOR SELECT TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));
DROP POLICY IF EXISTS "journey_events_insert_admin_manager" ON public.client_journey_events;
CREATE POLICY "journey_events_insert_admin_manager" ON public.client_journey_events FOR INSERT TO authenticated
WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));

-- brand_journey_stage_templates
DROP POLICY IF EXISTS "stage_templates_select_brand_members" ON public.brand_journey_stage_templates;
CREATE POLICY "stage_templates_select_brand_members" ON public.brand_journey_stage_templates FOR SELECT TO authenticated
USING (public.is_brand_member(brand_id, auth.uid()));
DROP POLICY IF EXISTS "stage_templates_modify_admin_manager" ON public.brand_journey_stage_templates;
CREATE POLICY "stage_templates_modify_admin_manager" ON public.brand_journey_stage_templates FOR ALL TO authenticated
USING (public.is_brand_admin_level(brand_id, auth.uid()))
WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()));

-- user_profiles: global admin sees team profiles (super admins stay hidden)
DROP POLICY IF EXISTS "Users see profiles of shared brand members" ON public.user_profiles;
CREATE POLICY "Users see profiles of shared brand members" ON public.user_profiles FOR SELECT TO authenticated
USING (
  (
    public.is_global_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm_self
      JOIN public.brand_members bm_other ON bm_other.brand_id = bm_self.brand_id
      WHERE bm_self.user_id = auth.uid() AND bm_other.user_id = user_profiles.id
    )
  )
  AND ((NOT public.is_super_admin(id)) OR public.is_super_admin(auth.uid()))
);
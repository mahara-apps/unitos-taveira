-- ============================================================
-- Fase 1 RBAC — RLS client-scoped (tabelas operacionais)
-- Regra: client_in_scope(client_id, brand_id)
-- ============================================================

-- client_documents ------------------------------------------------
DROP POLICY IF EXISTS "brand members read documents" ON public.client_documents;
DROP POLICY IF EXISTS "brand members insert documents" ON public.client_documents;
DROP POLICY IF EXISTS "brand members update documents" ON public.client_documents;
DROP POLICY IF EXISTS "brand members delete documents" ON public.client_documents;
CREATE POLICY "documents in client scope read" ON public.client_documents
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "documents in client scope insert" ON public.client_documents
  FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));
CREATE POLICY "documents in client scope update" ON public.client_documents
  FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.client_in_scope(client_id, brand_id));
CREATE POLICY "documents in client scope delete" ON public.client_documents
  FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

-- calendar_events -------------------------------------------------
DROP POLICY IF EXISTS "calendar_events_select_global_or_member" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_insert" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_update" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar_events_delete" ON public.calendar_events;
CREATE POLICY "calendar_events_select_global_or_scope" ON public.calendar_events
  FOR SELECT TO authenticated
  USING (is_global = true OR public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));
CREATE POLICY "calendar_events_insert" ON public.calendar_events
  FOR INSERT TO authenticated
  WITH CHECK (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (is_global = false AND public.client_in_scope(client_id, brand_id))
  );
CREATE POLICY "calendar_events_update" ON public.calendar_events
  FOR UPDATE TO authenticated
  USING ((is_global = true AND public.is_super_admin(auth.uid())) OR public.client_in_scope(client_id, brand_id))
  WITH CHECK ((is_global = true AND public.is_super_admin(auth.uid())) OR public.client_in_scope(client_id, brand_id));
CREATE POLICY "calendar_events_delete" ON public.calendar_events
  FOR DELETE TO authenticated
  USING ((is_global = true AND public.is_super_admin(auth.uid())) OR public.client_in_scope(client_id, brand_id));

-- social_posts ----------------------------------------------------
DROP POLICY IF EXISTS "social_posts brand members read" ON public.social_posts;
DROP POLICY IF EXISTS "social_posts brand members insert" ON public.social_posts;
DROP POLICY IF EXISTS "social_posts brand members update" ON public.social_posts;
DROP POLICY IF EXISTS "social_posts brand members delete" ON public.social_posts;
CREATE POLICY "social_posts in client scope read" ON public.social_posts
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "social_posts in client scope insert" ON public.social_posts
  FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));
CREATE POLICY "social_posts in client scope update" ON public.social_posts
  FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "social_posts in client scope delete" ON public.social_posts
  FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

-- social_connections (nível workspace; client_id legado quando presente) ---
DROP POLICY IF EXISTS "social_connections brand members read" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections admins insert" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections admins update" ON public.social_connections;
DROP POLICY IF EXISTS "social_connections admins delete" ON public.social_connections;
CREATE POLICY "social_connections in scope read" ON public.social_connections
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "social_connections admins insert" ON public.social_connections
  FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
CREATE POLICY "social_connections admins update" ON public.social_connections
  FOR UPDATE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
CREATE POLICY "social_connections admins delete" ON public.social_connections
  FOR DELETE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));

-- client_social_accounts -----------------------------------------
DROP POLICY IF EXISTS "csa brand members read" ON public.client_social_accounts;
DROP POLICY IF EXISTS "csa admins insert" ON public.client_social_accounts;
DROP POLICY IF EXISTS "csa admins update" ON public.client_social_accounts;
DROP POLICY IF EXISTS "csa admins delete" ON public.client_social_accounts;
CREATE POLICY "csa in client scope read" ON public.client_social_accounts
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "csa admins insert" ON public.client_social_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
CREATE POLICY "csa admins update" ON public.client_social_accounts
  FOR UPDATE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
CREATE POLICY "csa admins delete" ON public.client_social_accounts
  FOR DELETE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));

-- content_pipelines ----------------------------------------------
DROP POLICY IF EXISTS "brand members read pipelines" ON public.content_pipelines;
DROP POLICY IF EXISTS "brand members insert pipelines" ON public.content_pipelines;
DROP POLICY IF EXISTS "brand members update pipelines" ON public.content_pipelines;
DROP POLICY IF EXISTS "brand members delete pipelines" ON public.content_pipelines;
CREATE POLICY "pipelines in client scope read" ON public.content_pipelines
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "pipelines in client scope insert" ON public.content_pipelines
  FOR INSERT TO authenticated WITH CHECK (public.client_in_scope(client_id, brand_id));
CREATE POLICY "pipelines in client scope update" ON public.content_pipelines
  FOR UPDATE TO authenticated USING (public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.client_in_scope(client_id, brand_id));
CREATE POLICY "pipelines in client scope delete" ON public.content_pipelines
  FOR DELETE TO authenticated USING (public.client_in_scope(client_id, brand_id));

-- plan_overage_requests ------------------------------------------
DROP POLICY IF EXISTS "Brand members read overage requests" ON public.plan_overage_requests;
DROP POLICY IF EXISTS "Brand members request overage" ON public.plan_overage_requests;
DROP POLICY IF EXISTS "Owners and managers decide overage" ON public.plan_overage_requests;
DROP POLICY IF EXISTS "Owners and managers delete overage" ON public.plan_overage_requests;
CREATE POLICY "overage in client scope read" ON public.plan_overage_requests
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "overage in client scope insert" ON public.plan_overage_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.client_in_scope(client_id, brand_id) AND requested_by = auth.uid());
CREATE POLICY "overage admins decide" ON public.plan_overage_requests
  FOR UPDATE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
CREATE POLICY "overage admins delete" ON public.plan_overage_requests
  FOR DELETE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));

-- ai_jobs ---------------------------------------------------------
DROP POLICY IF EXISTS "brand members read ai_jobs" ON public.ai_jobs;
DROP POLICY IF EXISTS "brand members create ai_jobs" ON public.ai_jobs;
CREATE POLICY "ai_jobs in client scope read" ON public.ai_jobs
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "ai_jobs in client scope insert" ON public.ai_jobs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.client_in_scope(client_id, brand_id));

-- brand_ai_usage --------------------------------------------------
DROP POLICY IF EXISTS "brand members read ai usage" ON public.brand_ai_usage;
CREATE POLICY "ai usage in client scope read" ON public.brand_ai_usage
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));

-- monthly_plan_tokens ---------------------------------------------
DROP POLICY IF EXISTS "Brand members manage monthly plan tokens" ON public.monthly_plan_tokens;
CREATE POLICY "monthly plan tokens in client scope" ON public.monthly_plan_tokens
  FOR ALL TO authenticated
  USING (public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.client_in_scope(client_id, brand_id));

-- client_journey_events -------------------------------------------
DROP POLICY IF EXISTS "journey_events_select_brand_members" ON public.client_journey_events;
DROP POLICY IF EXISTS "journey_events_insert_admin_manager" ON public.client_journey_events;
CREATE POLICY "journey_events in client scope read" ON public.client_journey_events
  FOR SELECT TO authenticated USING (public.client_in_scope(client_id, brand_id));
CREATE POLICY "journey_events in client scope insert" ON public.client_journey_events
  FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));

-- brand_media_assets ---------------------------------------------
DROP POLICY IF EXISTS "brand members manage media" ON public.brand_media_assets;
CREATE POLICY "media in client scope" ON public.brand_media_assets
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));

-- brand_cohorts ---------------------------------------------------
DROP POLICY IF EXISTS "brand members access cohorts" ON public.brand_cohorts;
CREATE POLICY "cohorts in client scope" ON public.brand_cohorts
  FOR ALL TO authenticated
  USING (public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.client_in_scope(client_id, brand_id));

-- client_members --------------------------------------------------
DROP POLICY IF EXISTS "owners/managers manage client memberships" ON public.client_members;
DROP POLICY IF EXISTS "read own client memberships" ON public.client_members;
CREATE POLICY "client memberships read in scope" ON public.client_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id)));
CREATE POLICY "client memberships manage in scope" ON public.client_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
CREATE POLICY "client memberships update in scope" ON public.client_members
  FOR UPDATE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id))
  WITH CHECK (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
CREATE POLICY "client memberships delete in scope" ON public.client_members
  FOR DELETE TO authenticated
  USING (public.is_brand_admin_level(brand_id, auth.uid()) AND public.client_in_scope(client_id, brand_id));
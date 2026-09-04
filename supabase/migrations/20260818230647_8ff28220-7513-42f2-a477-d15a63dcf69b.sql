-- Regra canônica: identidade da agência e etapas de pipeline só podem ser
-- alteradas por super_admin / admin (owner) / manager.
CREATE OR REPLACE FUNCTION public.is_brand_admin_level(_brand_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.app_access_role(_user_id, _brand_id) IN ('super_admin', 'admin', 'manager');
$$;

GRANT EXECUTE ON FUNCTION public.is_brand_admin_level(uuid, uuid) TO authenticated;

-- brands: alinhar UPDATE com a regra canônica (antes: apenas owner)
DROP POLICY IF EXISTS "owner updates brand" ON public.brands;
CREATE POLICY "admin level updates brand"
ON public.brands FOR UPDATE TO authenticated
USING (public.is_brand_admin_level(id, auth.uid()))
WITH CHECK (public.is_brand_admin_level(id, auth.uid()));

-- content_pipeline_stages: leitura mantida para membros; escrita só admin level
DROP POLICY IF EXISTS "brand members write stages" ON public.content_pipeline_stages;
DROP POLICY IF EXISTS "brand members update stages" ON public.content_pipeline_stages;
DROP POLICY IF EXISTS "brand members delete stages" ON public.content_pipeline_stages;

CREATE POLICY "admin level insert stages"
ON public.content_pipeline_stages FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.content_pipelines p
  WHERE p.id = content_pipeline_stages.pipeline_id
    AND public.is_brand_admin_level(p.brand_id, auth.uid())
));

CREATE POLICY "admin level update stages"
ON public.content_pipeline_stages FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.content_pipelines p
  WHERE p.id = content_pipeline_stages.pipeline_id
    AND public.is_brand_admin_level(p.brand_id, auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.content_pipelines p
  WHERE p.id = content_pipeline_stages.pipeline_id
    AND public.is_brand_admin_level(p.brand_id, auth.uid())
));

CREATE POLICY "admin level delete stages"
ON public.content_pipeline_stages FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.content_pipelines p
  WHERE p.id = content_pipeline_stages.pipeline_id
    AND public.is_brand_admin_level(p.brand_id, auth.uid())
));
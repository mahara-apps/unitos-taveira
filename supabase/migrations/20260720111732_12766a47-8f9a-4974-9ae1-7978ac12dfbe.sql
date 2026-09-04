
-- 1) feature_catalog
CREATE TABLE public.feature_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text,
  icon text,
  is_core boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.feature_catalog TO authenticated;
GRANT ALL ON public.feature_catalog TO service_role;
ALTER TABLE public.feature_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feature_catalog_select_authenticated"
  ON public.feature_catalog FOR SELECT TO authenticated USING (true);

CREATE POLICY "feature_catalog_insert_superadmin"
  ON public.feature_catalog FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "feature_catalog_update_superadmin"
  ON public.feature_catalog FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "feature_catalog_delete_superadmin"
  ON public.feature_catalog FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- 2) brand_features
CREATE TABLE public.brand_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES public.feature_catalog(key) ON UPDATE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, feature_key)
);
CREATE INDEX brand_features_brand_id_idx ON public.brand_features(brand_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_features TO authenticated;
GRANT ALL ON public.brand_features TO service_role;
ALTER TABLE public.brand_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_features_select_members_or_superadmin"
  ON public.brand_features FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "brand_features_insert_superadmin"
  ON public.brand_features FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "brand_features_update_superadmin"
  ON public.brand_features FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "brand_features_delete_superadmin"
  ON public.brand_features FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_brand_features_updated_at
  BEFORE UPDATE ON public.brand_features
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Seed catálogo
INSERT INTO public.feature_catalog (key, name, description, category, icon, is_core) VALUES
  ('brain',       'Brain',        'Memória viva da agência e camada de inteligência.', 'Inteligência', 'Brain',        false),
  ('chat',        'Chat',         'Chat Brain-first com fallback para modelos generativos.', 'Inteligência', 'MessageSquare', false),
  ('midia_paga',  'Mídia Paga',   'Planejamento de mídia paga e integrações com Ads.', 'Marketing',    'Target',       false),
  ('blog_post',   'Conteúdo/Blog', 'Editor e pipeline de conteúdo para blog e artigos.', 'Marketing',    'FileText',     false),
  ('dashboard',   'Dashboard',    'Painel principal.',            'Core', 'LayoutDashboard', true),
  ('tasks',       'Tarefas',      'Gestão de tarefas.',           'Core', 'ListChecks',      true),
  ('calendar',    'Calendário',   'Calendário editorial.',        'Core', 'CalendarDays',    true),
  ('projects',    'Projetos',     'Projetos e entregas.',         'Core', 'FolderKanban',    true),
  ('customers',   'Clientes',     'Cadastro de clientes.',        'Core', 'Users',           true),
  ('analytics',   'Analytics',    'Métricas consolidadas.',       'Core', 'BarChart3',       true)
ON CONFLICT (key) DO NOTHING;

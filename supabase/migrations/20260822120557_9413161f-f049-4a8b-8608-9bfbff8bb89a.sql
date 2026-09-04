-- 1) Catálogo central de features: ordenação, disponibilidade global e default
ALTER TABLE public.feature_catalog
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2) Seed / upsert do catálogo completo do Master
INSERT INTO public.feature_catalog (key, name, description, category, icon, is_core, sort_order, default_enabled)
VALUES
  ('dashboard','Dashboard','Visão geral consolidada do ambiente.','Visão Geral','LayoutDashboard', true, 10, true),
  ('analytics','Analytics','Métricas e desempenho das contas conectadas.','Visão Geral','BarChart3', false, 20, true),
  ('projects','Projetos','Gestão de projetos e execução de pautas.','Operação','FolderKanban', false, 30, true),
  ('monthly_plan','Pauta','Planejamento mensal de conteúdo gerado por IA.','Operação','ScrollText', false, 40, true),
  ('blog_post','Conteúdo','Kanban de produção de peças e publicações.','Operação','KanbanSquare', false, 50, true),
  ('calendar','Calendário','Central de agendamento e publicação.','Operação','CalendarDays', false, 60, true),
  ('tasks','Tarefas','Tarefas, subtarefas e apontamento de horas.','Operação','ListChecks', false, 70, true),
  ('midia_paga','Mídia Paga','Planos de mídia e investimento em anúncios.','Operação','Target', false, 80, false),
  ('customers','Clientes','Cadastro e painel dos clientes atendidos.','Gestão','Users', false, 90, true),
  ('connections','Integrações','Conexões de canais e contas sociais.','Gestão','Plug', false, 100, true),
  ('notifications','Notificações','Central de notificações do ambiente.','Gestão','Bell', false, 110, true),
  ('agents','Agentes IA','Agentes de IA e prompts operacionais.','Inteligência','Bot', false, 120, true),
  ('brain','Brain','Núcleo de inteligência central do Unitos.','Inteligência','Brain', false, 130, true),
  ('chat','Chat','Copiloto conversacional do ambiente.','Inteligência','MessageSquare', false, 140, false)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  is_core = EXCLUDED.is_core,
  sort_order = EXCLUDED.sort_order,
  default_enabled = EXCLUDED.default_enabled,
  updated_at = now();

-- 3) Preservar o estado efetivo atual: tudo que era core (sempre ON) passa a
--    ter linha explícita ON em cada marca existente.
INSERT INTO public.brand_features (brand_id, feature_key, enabled, enabled_at)
SELECT b.id, fc.key, true, now()
FROM public.brands b
CROSS JOIN public.feature_catalog fc
WHERE fc.default_enabled = true
ON CONFLICT (brand_id, feature_key) DO NOTHING;

-- 4) Novas marcas: habilitar features cujo default é ON (catálogo decide)
CREATE OR REPLACE FUNCTION public.enable_default_brand_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.brand_features (brand_id, feature_key, enabled, enabled_at)
  SELECT NEW.id, fc.key, true, now()
  FROM public.feature_catalog fc
  WHERE fc.default_enabled = true
  ON CONFLICT (brand_id, feature_key) DO NOTHING;
  RETURN NEW;
END;
$function$;
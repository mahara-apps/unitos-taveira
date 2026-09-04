CREATE OR REPLACE FUNCTION public.access_profiles_system_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT '[
    {"key":"atendimento","name":"Atendimento","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"view","approvals":"full","media_plans":"view","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"view"}},
    {"key":"criativo","name":"Criativo","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"own","content":"full","calendar":"view","approvals":"own","media_plans":"none","connections":"none","reports":"none","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"trafego","name":"Tráfego","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"own","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"midia","name":"Mídia","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"view","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"producao","name":"Produção","permissions":{"clients":"view","briefing":"view","projects":"own","tasks":"full","planning":"view","content":"own","calendar":"full","approvals":"own","media_plans":"none","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","portal":"none"}},
    {"key":"financeiro","name":"Financeiro","permissions":{"clients":"view","briefing":"none","projects":"view","tasks":"view","planning":"view","content":"none","calendar":"view","approvals":"none","media_plans":"view","connections":"none","reports":"full","users":"none","settings":"none","ai":"none","brain":"none","chat":"view","portal":"none"}},
    {"key":"total","name":"Total","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"full","approvals":"full","media_plans":"full","connections":"full","reports":"full","users":"full","settings":"full","ai":"full","brain":"full","chat":"full","portal":"full"}}
  ]'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.module_level_rank(_level text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(COALESCE(_level,'none'))
    WHEN 'full' THEN 3
    WHEN 'own' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END;
$$;
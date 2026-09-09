CREATE OR REPLACE FUNCTION public.access_profiles_system_defaults()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT '[
    {"key":"atendimento","name":"Atendimento","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"view","approvals":"full","media_plans":"view","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","messages":"full","portal":"view"}},
    {"key":"criativo","name":"Criativo","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"own","content":"full","calendar":"view","approvals":"own","media_plans":"none","connections":"none","reports":"none","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","messages":"full","portal":"none"}},
    {"key":"trafego","name":"Tráfego","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"own","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","messages":"full","portal":"none"}},
    {"key":"midia","name":"Mídia","permissions":{"clients":"view","briefing":"view","projects":"view","tasks":"own","planning":"view","content":"view","calendar":"view","approvals":"view","media_plans":"full","connections":"view","reports":"full","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","messages":"full","portal":"none"}},
    {"key":"producao","name":"Produção","permissions":{"clients":"view","briefing":"view","projects":"own","tasks":"full","planning":"view","content":"own","calendar":"full","approvals":"own","media_plans":"none","connections":"none","reports":"view","users":"none","settings":"none","ai":"own","brain":"view","chat":"full","messages":"full","portal":"none"}},
    {"key":"financeiro","name":"Financeiro","permissions":{"clients":"view","briefing":"none","projects":"view","tasks":"view","planning":"view","content":"none","calendar":"view","approvals":"none","media_plans":"view","connections":"none","reports":"full","users":"none","settings":"none","ai":"none","brain":"none","chat":"view","messages":"full","portal":"none"}},
    {"key":"total","name":"Total","permissions":{"clients":"full","briefing":"full","projects":"full","tasks":"full","planning":"full","content":"full","calendar":"full","approvals":"full","media_plans":"full","connections":"full","reports":"full","users":"full","settings":"full","ai":"full","brain":"full","chat":"full","messages":"full","portal":"full"}}
  ]'::jsonb;
$function$;

-- Perfis já existentes herdam o nível de Mensagens do Chat (padrão "full" quando ausente).
UPDATE public.access_profiles
   SET permissions = permissions || jsonb_build_object('messages', COALESCE(permissions ->> 'chat', 'full'))
 WHERE NOT (permissions ? 'messages');

-- Overrides individuais também herdam do Chat quando existirem.
UPDATE public.brand_members
   SET module_permissions = module_permissions || jsonb_build_object('messages', module_permissions ->> 'chat')
 WHERE module_permissions ? 'chat' AND NOT (module_permissions ? 'messages');
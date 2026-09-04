ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS app_url text;

COMMENT ON COLUMN public.brands.app_url IS 'URL canonica da instalacao que atende este workspace. Aprendida do host real das requisicoes e usada por jobs/cron/workers para montar links absolutos sem depender de variavel de ambiente global.';
ALTER TABLE public.content_pipeline_stages ADD COLUMN IF NOT EXISTS sla_hours integer;
UPDATE public.content_pipeline_stages SET sla_hours = sla_days * 24 WHERE sla_hours IS NULL AND sla_days IS NOT NULL;
COMMENT ON COLUMN public.content_pipeline_stages.sla_hours IS 'SLA em horas para a etapa. Coluna canônica; sla_days permanece como legado (compat).';
-- Garante trigger de updated_at em ai_jobs (necessário para o watchdog)
DROP TRIGGER IF EXISTS trg_ai_jobs_updated_at ON public.ai_jobs;
CREATE TRIGGER trg_ai_jobs_updated_at
BEFORE UPDATE ON public.ai_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Zera jobs zumbis já existentes
UPDATE public.ai_jobs
SET status = 'failed',
    error  = 'reset manual — worker foi reiniciado',
    finished_at = now(),
    step_label = null
WHERE status IN ('queued', 'running');
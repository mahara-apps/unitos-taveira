CREATE OR REPLACE FUNCTION public.protect_pipeline_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next uuid;
BEGIN
  -- Durante ON DELETE CASCADE, a linha-pai de clients já não está visível.
  -- Nesse caso, todos os pipelines do cliente devem acompanhar a exclusão.
  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = OLD.client_id
  ) THEN
    RETURN OLD;
  END IF;

  -- Em uma exclusão isolada, o cliente ainda existe: preserve sempre um
  -- pipeline padrão e bloqueie a remoção do último pipeline.
  IF OLD.is_default THEN
    SELECT id INTO v_next
      FROM public.content_pipelines
      WHERE client_id = OLD.client_id
        AND id <> OLD.id
      ORDER BY position ASC, created_at ASC
      LIMIT 1;

    IF v_next IS NULL THEN
      RAISE EXCEPTION 'cannot_delete_last_pipeline';
    END IF;

    UPDATE public.content_pipelines
       SET is_default = true
     WHERE id = v_next;
  END IF;

  RETURN OLD;
END;
$$;
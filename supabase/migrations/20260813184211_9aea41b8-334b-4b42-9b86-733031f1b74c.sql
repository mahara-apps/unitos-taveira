-- Fase 1: stage_id como fonte operacional, posts.stage mantido sincronizado (legado)

CREATE OR REPLACE FUNCTION public.derive_post_stage(_stage_id uuid, _current public.post_stage)
RETURNS public.post_stage
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _key text;
  _terminal boolean;
BEGIN
  IF _stage_id IS NULL THEN
    RETURN _current;
  END IF;

  SELECT lower(s.key), COALESCE(s.is_terminal, false)
    INTO _key, _terminal
  FROM public.content_pipeline_stages s
  WHERE s.id = _stage_id;

  -- Stage inexistente: preserva o valor legado atual
  IF _key IS NULL THEN
    RETURN _current;
  END IF;

  -- Mapeamento canônico key -> enum post_stage
  IF _key IN ('idea', 'production', 'review', 'approved', 'scheduled', 'published') THEN
    RETURN _key::public.post_stage;
  END IF;

  -- Fallback documentado para stages customizados sem correspondência no enum:
  -- 1) coluna terminal -> 'scheduled' (mantém o comportamento legado do movePostFn);
  -- 2) qualquer outra coluna customizada -> preserva o valor legado atual
  --    (nunca inventamos um valor de enum).
  IF _terminal THEN
    RETURN 'scheduled'::public.post_stage;
  END IF;

  RETURN _current;
END;
$$;

REVOKE ALL ON FUNCTION public.derive_post_stage(uuid, public.post_stage) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.derive_post_stage(uuid, public.post_stage) FROM anon;
REVOKE ALL ON FUNCTION public.derive_post_stage(uuid, public.post_stage) FROM authenticated;

-- Garantia de consistência: só espelha stage_id -> stage, sem regra de negócio
CREATE OR REPLACE FUNCTION public.posts_sync_legacy_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS NOT NULL THEN
    NEW.stage := public.derive_post_stage(NEW.stage_id, NEW.stage);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_sync_legacy_stage ON public.posts;
CREATE TRIGGER posts_sync_legacy_stage
BEFORE INSERT OR UPDATE OF stage_id ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.posts_sync_legacy_stage();

-- Backfill de consistência (não altera stage_id)
UPDATE public.posts p
SET stage = public.derive_post_stage(p.stage_id, p.stage)
WHERE p.stage_id IS NOT NULL
  AND p.stage <> public.derive_post_stage(p.stage_id, p.stage);

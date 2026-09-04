
-- 1) Lifecycle columns
ALTER TABLE public.brain_memory
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS previous_confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reinforcement_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contradiction_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_brain_memory_last_accessed ON public.brain_memory (last_accessed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_brain_memory_origin ON public.brain_memory (origin);

-- 2) Version history table
CREATE TABLE IF NOT EXISTS public.brain_memory_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES public.brain_memory(id) ON DELETE CASCADE,
  brand_id uuid,
  version int NOT NULL,
  confidence numeric(4,3) NOT NULL,
  previous_confidence numeric(4,3),
  delta_confidence numeric(5,3),
  title text,
  description text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  relations jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  change_reason text,
  source_event uuid,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.brain_memory_versions TO authenticated;
GRANT ALL ON public.brain_memory_versions TO service_role;
ALTER TABLE public.brain_memory_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brain_memory_versions select by brand" ON public.brain_memory_versions;
CREATE POLICY "brain_memory_versions select by brand"
  ON public.brain_memory_versions FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (brand_id IS NOT NULL AND public.is_brand_member(brand_id, auth.uid()))
  );

CREATE INDEX IF NOT EXISTS idx_brain_memory_versions_memory ON public.brain_memory_versions (memory_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_brain_memory_versions_brand  ON public.brain_memory_versions (brand_id, created_at DESC);

-- 3) Snapshot + version-bump trigger
CREATE OR REPLACE FUNCTION public.brain_memory_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed boolean := false;
  reason text := NULL;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    changed :=
      OLD.content    IS DISTINCT FROM NEW.content
   OR OLD.confidence IS DISTINCT FROM NEW.confidence
   OR OLD.title       IS DISTINCT FROM NEW.title
   OR OLD.description IS DISTINCT FROM NEW.description
   OR OLD.status      IS DISTINCT FROM NEW.status
   OR OLD.tags        IS DISTINCT FROM NEW.tags
   OR OLD.relations   IS DISTINCT FROM NEW.relations;

    IF NOT changed THEN
      RETURN NEW;
    END IF;

    IF OLD.confidence IS DISTINCT FROM NEW.confidence THEN
      reason := CASE WHEN NEW.confidence > OLD.confidence THEN 'reinforced'
                     WHEN NEW.confidence < OLD.confidence THEN 'weakened'
                     ELSE 'updated' END;
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      reason := 'status_change';
    ELSE
      reason := 'content_update';
    END IF;

    NEW.previous_confidence := OLD.confidence;
    NEW.version    := COALESCE(OLD.version, 1) + 1;
    NEW.updated_at := now();

    INSERT INTO public.brain_memory_versions
      (memory_id, brand_id, version, confidence, previous_confidence, delta_confidence,
       title, description, content, tags, relations, metadata, status, change_reason,
       source_event, changed_by)
    VALUES
      (OLD.id, OLD.brand_id, OLD.version, OLD.confidence, OLD.previous_confidence,
       (NEW.confidence - OLD.confidence),
       OLD.title, OLD.description, OLD.content, OLD.tags, OLD.relations, OLD.metadata,
       OLD.status, reason, OLD.source_event, auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS brain_memory_snapshot_trg ON public.brain_memory;
CREATE TRIGGER brain_memory_snapshot_trg
BEFORE UPDATE ON public.brain_memory
FOR EACH ROW EXECUTE FUNCTION public.brain_memory_snapshot();

-- 4) Evolve function: upsert-with-evidence (no duplicates, WMA on confidence)
CREATE OR REPLACE FUNCTION public.brain_memory_evolve(
  _brand_id      uuid,
  _entity_type   text,
  _entity_id     uuid,
  _category      text,
  _title         text,
  _description   text DEFAULT NULL,
  _content       jsonb DEFAULT '{}'::jsonb,
  _evidence_confidence numeric DEFAULT 0.6,
  _origin        text DEFAULT 'system',
  _source_event  uuid DEFAULT NULL,
  _tags          text[] DEFAULT '{}',
  _relations     jsonb DEFAULT '[]'::jsonb,
  _metadata      jsonb DEFAULT '{}'::jsonb,
  _contradicts   boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing public.brain_memory%ROWTYPE;
  new_conf numeric;
  new_id uuid;
  ev_weight numeric := 0.35; -- weight of new evidence in WMA
  ref_entry jsonb;
BEGIN
  IF _brand_id IS NOT NULL AND NOT (public.is_brand_member(_brand_id, auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO existing
    FROM public.brain_memory
   WHERE COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND entity_type = _entity_type
     AND entity_id   = _entity_id
     AND category    = _category
     AND title       = _title
   LIMIT 1;

  ref_entry := jsonb_build_object(
    'at', to_jsonb(now()),
    'source_event', _source_event,
    'origin', _origin,
    'evidence', _evidence_confidence,
    'contradicts', _contradicts
  );

  IF FOUND THEN
    -- Weighted moving average with contradiction penalty
    IF _contradicts THEN
      new_conf := GREATEST(0.02, existing.confidence - (ev_weight * _evidence_confidence));
    ELSE
      new_conf := LEAST(0.99, (1.0 - ev_weight) * existing.confidence + ev_weight * _evidence_confidence);
    END IF;

    UPDATE public.brain_memory SET
      description = COALESCE(_description, description),
      content     = content || COALESCE(_content, '{}'::jsonb),
      confidence  = ROUND(new_conf, 3),
      tags        = ARRAY(SELECT DISTINCT unnest(tags || COALESCE(_tags, '{}'))),
      relations   = COALESCE(relations, '[]'::jsonb) || COALESCE(_relations, '[]'::jsonb),
      metadata    = metadata || COALESCE(_metadata, '{}'::jsonb),
      source_refs = COALESCE(source_refs, '[]'::jsonb) || jsonb_build_array(ref_entry),
      reinforcement_count = reinforcement_count + CASE WHEN _contradicts THEN 0 ELSE 1 END,
      contradiction_count = contradiction_count + CASE WHEN _contradicts THEN 1 ELSE 0 END,
      status      = CASE WHEN existing.status = 'archived' AND NOT _contradicts THEN 'active' ELSE existing.status END,
      source_event = COALESCE(_source_event, source_event),
      origin       = COALESCE(existing.origin, _origin)
    WHERE id = existing.id;

    RETURN existing.id;
  END IF;

  -- Insert new memory
  INSERT INTO public.brain_memory
    (brand_id, memory_type, scope, key, content, confidence,
     entity_type, entity_id, category, title, description,
     source_event, tags, relations, metadata, status,
     version, origin, source_refs, reinforcement_count)
  VALUES
    (_brand_id, COALESCE(_category, 'general'),
     CASE WHEN _brand_id IS NULL THEN 'global' ELSE 'brand' END,
     _title, COALESCE(_content, '{}'::jsonb),
     ROUND(LEAST(0.95, GREATEST(0.05, _evidence_confidence))::numeric, 3),
     _entity_type, _entity_id, _category, _title, _description,
     _source_event, COALESCE(_tags, '{}'), COALESCE(_relations, '[]'::jsonb),
     COALESCE(_metadata, '{}'::jsonb), 'active',
     1, _origin, jsonb_build_array(ref_entry), 1)
  RETURNING id INTO new_id;

  RETURN new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.brain_memory_evolve(uuid,text,uuid,text,text,text,jsonb,numeric,text,uuid,text[],jsonb,jsonb,boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.brain_memory_evolve(uuid,text,uuid,text,text,text,jsonb,numeric,text,uuid,text[],jsonb,jsonb,boolean) FROM anon, public;

-- 5) Access tracking
CREATE OR REPLACE FUNCTION public.brain_memory_touch(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.brain_memory
       SET access_count = access_count + 1,
           last_accessed_at = now()
     WHERE id = ANY(_ids)
       AND (brand_id IS NULL
            OR public.is_brand_member(brand_id, auth.uid())
            OR public.is_super_admin(auth.uid()))
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION public.brain_memory_touch(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.brain_memory_touch(uuid[]) FROM anon, public;

-- 6) Decay + archive stale/weak memories
CREATE OR REPLACE FUNCTION public.brain_memory_decay_and_archive()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE archived integer;
BEGIN
  WITH upd AS (
    UPDATE public.brain_memory
       SET status = 'archived'
     WHERE status = 'active'
       AND (
         (confidence < 0.15 AND updated_at < now() - interval '14 days')
         OR (last_accessed_at IS NOT NULL AND last_accessed_at < now() - interval '180 days' AND confidence < 0.4)
         OR (expires_at IS NOT NULL AND expires_at < now())
       )
    RETURNING 1
  )
  SELECT count(*) INTO archived FROM upd;
  RETURN archived;
END $$;

GRANT EXECUTE ON FUNCTION public.brain_memory_decay_and_archive() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.brain_memory_decay_and_archive() FROM anon, public;


-- Fase A: backfill defensivo (idempotente). brain_knowledge → brain_memory.
-- brain_memory não possui client_id: usamos subject_type='client' + subject_id.
INSERT INTO public.brain_memory
  (brand_id, subject_type, subject_id,
   memory_type, scope, key, content, category,
   confidence, source_refs, reinforcement_count, origin, status)
SELECT
  bk.brand_id,
  CASE WHEN bk.client_id IS NOT NULL THEN 'client' ELSE NULL END AS subject_type,
  bk.client_id                                    AS subject_id,
  bk.category                                     AS memory_type,
  CASE WHEN bk.client_id IS NOT NULL THEN 'client' ELSE 'brand' END AS scope,
  bk.key,
  jsonb_build_object('value', bk.value)           AS content,
  bk.category                                     AS category,
  bk.confidence,
  jsonb_build_object(
    'event_ids', to_jsonb(COALESCE(bk.source_event_ids, ARRAY[]::uuid[])),
    'legacy_source', bk.source
  )                                               AS source_refs,
  bk.reinforcement_count,
  'migration:brain_knowledge'                     AS origin,
  'active'                                        AS status
FROM public.brain_knowledge bk
WHERE NOT EXISTS (
  SELECT 1 FROM public.brain_memory bm
  WHERE bm.brand_id IS NOT DISTINCT FROM bk.brand_id
    AND bm.memory_type = bk.category
    AND bm.key = bk.key
    AND bm.subject_id IS NOT DISTINCT FROM bk.client_id
);

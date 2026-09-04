DO $$
DECLARE v_orphans int; v_emb int;
BEGIN
  -- 1) Encerrar órfãos da fila sem retry
  UPDATE public.brain_learning_queue q
     SET status = 'skipped',
         error = COALESCE(NULLIF(q.error, ''), 'orphan_event: event_id não existe em brain_events (evento expurgado)'),
         processed_at = COALESCE(q.processed_at, now()),
         updated_at = now()
   WHERE NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id)
     AND q.status <> 'skipped';

  -- 2) Remover as linhas órfãs remanescentes (não podem satisfazer a FK)
  DELETE FROM public.brain_learning_queue q
   WHERE NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id);

  DELETE FROM public.brain_embeddings b
   WHERE b.event_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = b.event_id);

  SELECT count(*) INTO v_orphans FROM public.brain_learning_queue q
   WHERE NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = q.event_id);
  SELECT count(*) INTO v_emb FROM public.brain_embeddings b
   WHERE b.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.brain_events e WHERE e.id = b.event_id);
  IF v_orphans <> 0 OR v_emb <> 0 THEN
    RAISE EXCEPTION 'orfaos remanescentes: fila=% embeddings=%', v_orphans, v_emb;
  END IF;
END $$;

-- 3) FKs reais (CASCADE: o expurgo por idade de brain_events remove dependentes,
--    eliminando estruturalmente a classe de órfãos)
ALTER TABLE public.brain_learning_queue
  ADD CONSTRAINT brain_learning_queue_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.brain_events(id) ON DELETE CASCADE;

ALTER TABLE public.brain_embeddings
  ADD CONSTRAINT brain_embeddings_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.brain_events(id) ON DELETE CASCADE;

-- 4) Renomear policies (regras inalteradas)
ALTER POLICY "brain_events_part_select" ON public.brain_events RENAME TO "brain_events_select";
ALTER POLICY "brain_events_part_insert" ON public.brain_events RENAME TO "brain_events_insert";
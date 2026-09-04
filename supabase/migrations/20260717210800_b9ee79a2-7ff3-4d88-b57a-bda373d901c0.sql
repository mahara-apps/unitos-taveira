
ALTER TABLE public.brain_memory DROP CONSTRAINT IF EXISTS brain_memory_memory_type_check;
ALTER TABLE public.brain_memory ADD CONSTRAINT brain_memory_memory_type_check
  CHECK (memory_type = ANY (ARRAY['short_term','long_term','episodic','semantic','pattern','preference','fact']::text[]));

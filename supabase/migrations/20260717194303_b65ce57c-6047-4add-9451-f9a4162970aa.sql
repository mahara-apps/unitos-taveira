
-- Fase B: descontinuar brain_knowledge (fonte única = brain_memory)
DROP TRIGGER IF EXISTS brain_knowledge_touch ON public.brain_knowledge;
DROP TABLE IF EXISTS public.brain_knowledge;


-- Habilita RLS em todas as partições atuais de brain_events
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'public.brain_events'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

-- Recria a função para habilitar RLS em novas partições
CREATE OR REPLACE FUNCTION public.brain_ensure_event_partitions(_months_back int DEFAULT 3, _months_forward int DEFAULT 3)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i int; s date; e date; part_name text; created int := 0;
BEGIN
  FOR i IN -_months_back .. _months_forward LOOP
    s := (date_trunc('month', now()) + (i || ' months')::interval)::date;
    e := (s + interval '1 month')::date;
    part_name := format('brain_events_%s', to_char(s, 'YYYYMM'));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.brain_events FOR VALUES FROM (%L) TO (%L)',
        part_name, s, e);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', part_name);
      created := created + 1;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'brain_events_default') THEN
    EXECUTE 'CREATE TABLE public.brain_events_default PARTITION OF public.brain_events DEFAULT';
    EXECUTE 'ALTER TABLE public.brain_events_default ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.brain_events_default FORCE ROW LEVEL SECURITY';
    created := created + 1;
  END IF;
  RETURN created;
END $$;

REVOKE EXECUTE ON FUNCTION public.brain_ensure_event_partitions(int, int) FROM anon, authenticated;


-- Enum de tipos
DO $$ BEGIN
  CREATE TYPE public.calendar_event_type AS ENUM ('appointment', 'seasonal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  type public.calendar_event_type NOT NULL,
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  is_global boolean NOT NULL DEFAULT false,
  color text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_scope_ck CHECK (
    (is_global = true AND brand_id IS NULL) OR (is_global = false AND brand_id IS NOT NULL)
  ),
  CONSTRAINT calendar_events_seasonal_global_ck CHECK (
    is_global = false OR type = 'seasonal'
  )
);

CREATE INDEX IF NOT EXISTS calendar_events_brand_starts_idx
  ON public.calendar_events (brand_id, starts_at);
CREATE INDEX IF NOT EXISTS calendar_events_global_starts_idx
  ON public.calendar_events (starts_at) WHERE is_global = true;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_events TO authenticated;
GRANT ALL ON public.calendar_events TO service_role;

-- RLS
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- SELECT: eventos globais para qualquer autenticado; eventos por marca para membros
CREATE POLICY "calendar_events_select_global_or_member"
  ON public.calendar_events FOR SELECT
  TO authenticated
  USING (
    is_global = true
    OR public.is_super_admin(auth.uid())
    OR (brand_id IS NOT NULL AND public.is_brand_member(auth.uid(), brand_id))
  );

-- INSERT
CREATE POLICY "calendar_events_insert"
  ON public.calendar_events FOR INSERT
  TO authenticated
  WITH CHECK (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (
      is_global = false
      AND brand_id IS NOT NULL
      AND public.is_brand_member(auth.uid(), brand_id)
    )
  );

-- UPDATE
CREATE POLICY "calendar_events_update"
  ON public.calendar_events FOR UPDATE
  TO authenticated
  USING (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (brand_id IS NOT NULL AND public.is_brand_member(auth.uid(), brand_id))
  )
  WITH CHECK (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (brand_id IS NOT NULL AND public.is_brand_member(auth.uid(), brand_id))
  );

-- DELETE
CREATE POLICY "calendar_events_delete"
  ON public.calendar_events FOR DELETE
  TO authenticated
  USING (
    (is_global = true AND public.is_super_admin(auth.uid()))
    OR (brand_id IS NOT NULL AND public.is_brand_member(auth.uid(), brand_id))
  );

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.calendar_events_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_events_touch_updated_at ON public.calendar_events;
CREATE TRIGGER calendar_events_touch_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.calendar_events_touch_updated_at();

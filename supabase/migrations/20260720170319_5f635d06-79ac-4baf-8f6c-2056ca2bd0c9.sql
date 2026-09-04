CREATE TABLE public.meta_compliance_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('deauthorize','data_deletion')),
  meta_user_id TEXT NOT NULL,
  confirmation_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'received',
  affected_connections INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_meta_compliance_events_meta_user ON public.meta_compliance_events(meta_user_id);
CREATE INDEX idx_meta_compliance_events_code ON public.meta_compliance_events(confirmation_code);

GRANT ALL ON public.meta_compliance_events TO service_role;

ALTER TABLE public.meta_compliance_events ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: this table is service-role only.

CREATE TABLE public.whatsapp_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid,
  type text NOT NULL CHECK (type IN ('client_contact','account_manager','workspace_admin','workspace_user','whatsapp_group')),
  name text NOT NULL,
  role_label text,
  destination text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_recipients_destination_required CHECK (
    (type IN ('client_contact','whatsapp_group') AND destination IS NOT NULL AND length(btrim(destination)) > 0)
    OR (type IN ('account_manager','workspace_admin','workspace_user') AND destination IS NULL)
  ),
  CONSTRAINT whatsapp_recipients_group_jid CHECK (
    type <> 'whatsapp_group' OR destination ~ '^[0-9]+(-[0-9]+)?@g\.us$'
  ),
  CONSTRAINT whatsapp_recipients_phone_digits CHECK (
    type <> 'client_contact' OR destination ~ '^[0-9]{10,15}$'
  ),
  CONSTRAINT whatsapp_recipients_user_required CHECK (
    type <> 'workspace_user' OR user_id IS NOT NULL
  ),
  CONSTRAINT whatsapp_recipients_client_required CHECK (
    type NOT IN ('client_contact','account_manager','whatsapp_group') OR client_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX whatsapp_recipients_unique_destination
  ON public.whatsapp_recipients (brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), type, destination)
  WHERE destination IS NOT NULL;

CREATE UNIQUE INDEX whatsapp_recipients_unique_user
  ON public.whatsapp_recipients (brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), type, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX whatsapp_recipients_unique_dynamic
  ON public.whatsapp_recipients (brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), type)
  WHERE user_id IS NULL AND destination IS NULL;

CREATE INDEX whatsapp_recipients_brand_client_idx
  ON public.whatsapp_recipients (brand_id, client_id) WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_recipients TO authenticated;
GRANT ALL ON public.whatsapp_recipients TO service_role;

ALTER TABLE public.whatsapp_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_recipients_select_scoped"
  ON public.whatsapp_recipients FOR SELECT TO authenticated
  USING (public.client_in_scope(client_id, brand_id));

CREATE POLICY "whatsapp_recipients_insert_scoped"
  ON public.whatsapp_recipients FOR INSERT TO authenticated
  WITH CHECK (
    public.client_in_scope(client_id, brand_id)
    AND (
      client_id IS NOT NULL
      OR public.app_access_role(auth.uid(), brand_id) IN ('super_admin','admin')
    )
  );

CREATE POLICY "whatsapp_recipients_update_scoped"
  ON public.whatsapp_recipients FOR UPDATE TO authenticated
  USING (
    public.client_in_scope(client_id, brand_id)
    AND (
      client_id IS NOT NULL
      OR public.app_access_role(auth.uid(), brand_id) IN ('super_admin','admin')
    )
  )
  WITH CHECK (
    public.client_in_scope(client_id, brand_id)
    AND (
      client_id IS NOT NULL
      OR public.app_access_role(auth.uid(), brand_id) IN ('super_admin','admin')
    )
  );

CREATE POLICY "whatsapp_recipients_delete_scoped"
  ON public.whatsapp_recipients FOR DELETE TO authenticated
  USING (
    public.client_in_scope(client_id, brand_id)
    AND (
      client_id IS NOT NULL
      OR public.app_access_role(auth.uid(), brand_id) IN ('super_admin','admin')
    )
  );

CREATE TRIGGER whatsapp_recipients_touch_updated_at
  BEFORE UPDATE ON public.whatsapp_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

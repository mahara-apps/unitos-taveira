ALTER TABLE public.brand_members
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.brand_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'editor',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brand_invites_brand_idx ON public.brand_invites(brand_id);
CREATE INDEX IF NOT EXISTS brand_invites_email_idx ON public.brand_invites(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_invites TO authenticated;
GRANT ALL ON public.brand_invites TO service_role;

ALTER TABLE public.brand_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand admins manage invites"
  ON public.brand_invites FOR ALL
  TO authenticated
  USING (
    public.has_brand_role(brand_id, auth.uid(), 'owner')
    OR public.has_brand_role(brand_id, auth.uid(), 'manager')
  )
  WITH CHECK (
    public.has_brand_role(brand_id, auth.uid(), 'owner')
    OR public.has_brand_role(brand_id, auth.uid(), 'manager')
  );

CREATE POLICY "invitee reads own invite"
  ON public.brand_invites FOR SELECT
  TO authenticated
  USING (
    lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );

CREATE TRIGGER brand_invites_updated_at
  BEFORE UPDATE ON public.brand_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.accept_brand_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
  v_invite public.brand_invites%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_invite FROM public.brand_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_invite.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'invite_already_accepted'; END IF;
  IF v_invite.expires_at < now() THEN RAISE EXCEPTION 'invite_expired'; END IF;
  IF lower(v_invite.email) <> v_user_email THEN RAISE EXCEPTION 'invite_email_mismatch'; END IF;

  INSERT INTO public.brand_members (brand_id, user_id, role, permissions)
  VALUES (v_invite.brand_id, v_user_id, v_invite.role, v_invite.permissions)
  ON CONFLICT (brand_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;

  UPDATE public.brand_invites SET accepted_at = now(), accepted_by = v_user_id WHERE id = v_invite.id;
  RETURN v_invite.brand_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_brand_invite(text) TO authenticated;
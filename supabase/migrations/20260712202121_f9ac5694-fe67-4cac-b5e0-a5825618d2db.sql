
-- 1. Add revocation & metadata columns
ALTER TABLE public.brand_invites
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid,
  ADD COLUMN IF NOT EXISTS temp_password_sent boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS requires_password_change boolean NOT NULL DEFAULT false;

-- 2. Update accept_brand_invite RPC to reject revoked / expired invites and clear temp flag
CREATE OR REPLACE FUNCTION public.accept_brand_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
  v_invite public.brand_invites%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_invite FROM public.brand_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invite_revoked'; END IF;
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
$function$;

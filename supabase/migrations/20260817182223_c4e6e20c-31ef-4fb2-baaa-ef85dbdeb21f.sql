DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='client_social_accounts'
      AND policyname='csa admins update'
  ) THEN
    CREATE POLICY "csa admins update"
      ON public.client_social_accounts
      FOR UPDATE TO authenticated
      USING (
        has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
        OR has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
        OR is_super_admin(auth.uid())
      )
      WITH CHECK (
        has_brand_role(brand_id, auth.uid(), 'owner'::app_role)
        OR has_brand_role(brand_id, auth.uid(), 'manager'::app_role)
        OR is_super_admin(auth.uid())
      );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_social_accounts TO authenticated;
GRANT ALL ON public.client_social_accounts TO service_role;
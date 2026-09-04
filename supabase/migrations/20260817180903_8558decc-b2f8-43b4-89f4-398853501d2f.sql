DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='meta_oauth_sessions'
      AND policyname='Users can update own meta sessions'
  ) THEN
    CREATE POLICY "Users can update own meta sessions"
      ON public.meta_oauth_sessions
      FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

GRANT SELECT, UPDATE, DELETE ON public.meta_oauth_sessions TO authenticated;
GRANT ALL ON public.meta_oauth_sessions TO service_role;
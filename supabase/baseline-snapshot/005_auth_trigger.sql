-- =============================================================================
-- 005_auth_trigger.sql — o UNICO objeto do estado atual que pg_dump --schema=public
-- nao consegue emitir: o trigger em auth.users (schema reservado do Supabase).
--
-- Estado real no banco de origem (lido de pg_trigger, somente leitura):
--   on_auth_user_created  AFTER INSERT ON auth.users  FOR EACH ROW
--     EXECUTE FUNCTION public.handle_new_user()
--
-- A funcao public.handle_new_user() JA esta em 001_initial_schema.sql.
-- Aplicar este arquivo DEPOIS do 001.
-- =============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

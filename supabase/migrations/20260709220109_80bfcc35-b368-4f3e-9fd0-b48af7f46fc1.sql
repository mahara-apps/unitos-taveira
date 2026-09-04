REVOKE ALL ON FUNCTION public.add_brand_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_brand_owner() FROM anon;
REVOKE ALL ON FUNCTION public.add_brand_owner() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_brand_owner() TO service_role;
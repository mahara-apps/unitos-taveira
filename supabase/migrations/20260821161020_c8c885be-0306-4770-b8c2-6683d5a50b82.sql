CREATE OR REPLACE FUNCTION public.enable_default_brand_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.brand_features (brand_id, feature_key, enabled, enabled_at)
  SELECT NEW.id, fc.key, true, now()
  FROM public.feature_catalog fc
  WHERE fc.is_core = false
  ON CONFLICT (brand_id, feature_key) DO NOTHING;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enable_default_brand_features ON public.brands;
CREATE TRIGGER trg_enable_default_brand_features
AFTER INSERT ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.enable_default_brand_features();

INSERT INTO public.brand_features (brand_id, feature_key, enabled, enabled_at)
SELECT b.id, fc.key, true, now()
FROM public.brands b
CROSS JOIN public.feature_catalog fc
WHERE fc.is_core = false
ON CONFLICT (brand_id, feature_key) DO NOTHING;
UPDATE public.feature_catalog
SET is_core = true,
    category = 'Core'
WHERE key = 'brain';

INSERT INTO public.brand_features (brand_id, feature_key, enabled, enabled_at)
SELECT b.id, 'brain', true, now()
FROM public.brands b
ON CONFLICT (brand_id, feature_key) DO UPDATE SET enabled = true;
UPDATE public.feature_catalog
SET is_core = true,
    category = 'Core',
    name = 'Conteúdo',
    description = 'Editor e pipeline de conteúdo (padrão do sistema).'
WHERE key = 'blog_post';

INSERT INTO public.brand_features (brand_id, feature_key, enabled, enabled_at)
SELECT b.id, 'blog_post', true, now()
FROM public.brands b
ON CONFLICT (brand_id, feature_key) DO UPDATE SET enabled = true;
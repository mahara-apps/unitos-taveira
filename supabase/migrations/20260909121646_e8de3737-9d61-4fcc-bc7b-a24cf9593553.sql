INSERT INTO public.feature_catalog (key, name, description, category, icon, default_enabled, is_available, is_core, sort_order)
VALUES ('messages', 'Mensagens', 'Central de mensagens entre time, clientes e portal.', 'Gestão', 'MessagesSquare', true, true, false, 105)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      icon = EXCLUDED.icon,
      default_enabled = true,
      is_available = true,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

INSERT INTO public.brand_features (brand_id, feature_key, enabled)
SELECT b.id, 'messages', true FROM public.brands b
ON CONFLICT (brand_id, feature_key) DO NOTHING;
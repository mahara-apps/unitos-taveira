DROP TRIGGER IF EXISTS on_brand_created_add_owner ON public.brands;

DROP TRIGGER IF EXISTS trg_brands_add_owner ON public.brands;

CREATE TRIGGER trg_brands_add_owner
AFTER INSERT ON public.brands
FOR EACH ROW
EXECUTE FUNCTION public.add_brand_owner();
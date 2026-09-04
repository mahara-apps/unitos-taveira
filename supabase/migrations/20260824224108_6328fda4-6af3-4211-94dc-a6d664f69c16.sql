CREATE OR REPLACE FUNCTION public.brain_trg_client_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.emit_brain_event(
    NEW.brand_id, 'file.uploaded', 'documents', auth.uid(),
    'document', NEW.id, 'created', NEW.client_id, NULL,
    jsonb_build_object('file_name', NEW.name)
  );
  RETURN NEW;
END; $function$;
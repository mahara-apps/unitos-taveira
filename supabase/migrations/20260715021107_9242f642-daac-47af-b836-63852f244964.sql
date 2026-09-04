ALTER FUNCTION public._portal_session(text) VOLATILE;
ALTER FUNCTION public.portal_resolve(text) VOLATILE;
ALTER FUNCTION public.portal_metrics(text) VOLATILE;
ALTER FUNCTION public.portal_approvals(text, text) VOLATILE;
ALTER FUNCTION public.portal_post(text, uuid) VOLATILE;
ALTER FUNCTION public.portal_calendar(text, text) VOLATILE;
ALTER FUNCTION public.portal_feed(text) VOLATILE;
ALTER FUNCTION public.portal_files(text, text) VOLATILE;
ALTER FUNCTION public.portal_briefings(text) VOLATILE;
REVOKE ALL ON FUNCTION public.brain_apply_partition_policies(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.brain_apply_partition_policies(text) FROM anon;
REVOKE ALL ON FUNCTION public.brain_apply_partition_policies(text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.brain_apply_partition_policies(text) TO service_role;

COMMENT ON FUNCTION public.brain_apply_partition_policies(text) IS
  'Uso interno (service_role / brain_ensure_event_partitions). EXECUTE revogado de PUBLIC, anon e authenticated (V2).';
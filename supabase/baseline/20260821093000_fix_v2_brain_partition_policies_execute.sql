-- V2 (ALTA) — brain_apply_partition_policies: remover EXECUTE de anon/authenticated
--
-- Contexto: public.brain_apply_partition_policies(text) é SECURITY DEFINER e
-- executa ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY, CREATE POLICY e GRANT
-- sobre tabelas do schema public. Ela só deve ser chamada pelo fluxo interno
-- (public.brain_ensure_event_partitions / service_role), nunca pela Data API.
--
-- Escopo desta migration: SOMENTE privilégios de EXECUTE desta função.
-- Não altera a implementação da função, nenhuma função canônica, nenhuma RLS
-- de tabela e nenhum grant de tabela.
--
-- Observação técnica: no Postgres, funções recebem EXECUTE para PUBLIC por
-- padrão. Revogar apenas de anon/authenticated não remove o privilégio efetivo,
-- pois ambos herdam de PUBLIC. Por isso o REVOKE de PUBLIC abaixo é
-- estritamente necessário para atingir o objetivo (anon/authenticated sem
-- EXECUTE), e o GRANT explícito a service_role preserva o fluxo interno.

REVOKE ALL ON FUNCTION public.brain_apply_partition_policies(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.brain_apply_partition_policies(text) FROM anon;
REVOKE ALL ON FUNCTION public.brain_apply_partition_policies(text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.brain_apply_partition_policies(text) TO service_role;

COMMENT ON FUNCTION public.brain_apply_partition_policies(text) IS
  'Uso interno (service_role / brain_ensure_event_partitions). EXECUTE revogado de PUBLIC, anon e authenticated (V2).';

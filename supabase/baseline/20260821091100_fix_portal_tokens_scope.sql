-- =============================================================================
-- FORWARD-ONLY (staging) — portal_tokens passa a respeitar o escopo de cliente
--
-- Problema: a policy usava is_brand_member(c.brand_id, auth.uid()), ou seja,
-- QUALQUER membro da marca (inclusive USER) podia criar/alterar/reativar token
-- de Portal de clientes fora do seu escopo.
--
-- Correção: usar a função canônica can_access_client_row(), que já implementa:
--   super_admin      → acesso total
--   owner(admin)/manager → todos os clientes da própria marca
--   user             → somente clientes onde é responsável (owner_user_id) ou
--                      está vinculado via client_members (não portal_client)
--   portal_client    → negado (excluído por definição na função)
--   outra marca      → negado
--
-- Nenhuma nova função de autorização é criada. Os fluxos legítimos do Portal
-- (RPCs SECURITY DEFINER _portal_session*/portal_*) não passam por esta policy
-- e continuam funcionando.
-- =============================================================================

DROP POLICY IF EXISTS "brand members manage portal tokens" ON public.portal_tokens;
DROP POLICY IF EXISTS "scoped members manage portal tokens" ON public.portal_tokens;

CREATE POLICY "scoped members manage portal tokens"
  ON public.portal_tokens FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = portal_tokens.client_id
         AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = portal_tokens.client_id
         AND public.can_access_client_row(c.id, c.brand_id, c.owner_user_id, auth.uid())
    )
  );

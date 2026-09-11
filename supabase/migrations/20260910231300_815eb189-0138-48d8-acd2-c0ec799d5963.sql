-- 1) Participantes: permitir que o criador da conversa insira os primeiros participantes.
DROP POLICY IF EXISTS "thread participants managed by team" ON public.message_thread_participants;
CREATE POLICY "thread participants managed by team"
  ON public.message_thread_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      public.can_access_message_thread(thread_id, auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.message_threads t
         WHERE t.id = message_thread_participants.thread_id
           AND public.is_brand_member(t.brand_id, auth.uid())
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.message_threads t
       WHERE t.id = message_thread_participants.thread_id
         AND t.created_by = auth.uid()
         AND public.is_brand_member(t.brand_id, auth.uid())
    )
  );

-- 2) Criação atômica e validada da conversa (+ participantes).
CREATE OR REPLACE FUNCTION public.create_message_thread(
  _brand_id uuid,
  _scope text,
  _subject text,
  _client_id uuid DEFAULT NULL,
  _project_id uuid DEFAULT NULL,
  _visibility text DEFAULT 'internal',
  _participant_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_scope text := _scope;
  v_visibility text;
  v_subject text := btrim(coalesce(_subject, ''));
  v_client uuid;
  v_project uuid;
  v_thread uuid;
  v_ids uuid[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_scope NOT IN ('client', 'team_dm', 'project') THEN
    RAISE EXCEPTION 'Escopo de conversa inválido';
  END IF;

  IF length(v_subject) < 2 THEN
    RAISE EXCEPTION 'Assunto obrigatório';
  END IF;

  IF NOT public.is_brand_member(_brand_id, v_user) THEN
    RAISE EXCEPTION 'Forbidden: workspace fora do seu escopo';
  END IF;

  IF NOT public.has_module_access(v_user, _brand_id, 'messages', 'own') THEN
    RAISE EXCEPTION 'Forbidden: sem permissão suficiente no módulo messages';
  END IF;

  -- Vínculos por escopo (mesmas fontes canônicas de autorização).
  v_client := CASE WHEN v_scope = 'team_dm' THEN NULL ELSE _client_id END;
  v_project := CASE WHEN v_scope = 'project' THEN _project_id ELSE NULL END;
  v_visibility := CASE WHEN v_scope = 'client' THEN coalesce(_visibility, 'internal') ELSE 'internal' END;

  IF v_visibility NOT IN ('internal', 'shared_with_client') THEN
    RAISE EXCEPTION 'Visibilidade inválida';
  END IF;

  IF v_scope <> 'team_dm' THEN
    IF v_client IS NULL THEN
      RAISE EXCEPTION 'Selecione o cliente da conversa';
    END IF;
    IF NOT public.can_access_client(v_client, v_user) THEN
      RAISE EXCEPTION 'Forbidden: cliente fora do seu escopo';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_client AND c.brand_id = _brand_id) THEN
      RAISE EXCEPTION 'Cliente não pertence a este workspace';
    END IF;
  END IF;

  IF v_scope = 'project' THEN
    IF v_project IS NULL THEN
      RAISE EXCEPTION 'Selecione o projeto da conversa';
    END IF;
    IF NOT public.can_access_project(v_project, v_user) THEN
      RAISE EXCEPTION 'Forbidden: projeto fora do seu escopo';
    END IF;
  END IF;

  INSERT INTO public.message_threads (
    brand_id, scope, subject, visibility, client_id, project_id, created_by
  ) VALUES (
    _brand_id, v_scope, v_subject, v_visibility, v_client, v_project, v_user
  )
  RETURNING id INTO v_thread;

  -- Participantes: autor + selecionados válidos.
  SELECT array_agg(DISTINCT x) INTO v_ids
    FROM unnest(array_append(coalesce(_participant_ids, '{}'::uuid[]), v_user)) AS x
   WHERE x IS NOT NULL;

  -- Equipe do workspace.
  INSERT INTO public.message_thread_participants (thread_id, user_id, role_in_thread)
  SELECT v_thread, bm.user_id, 'team'
    FROM public.brand_members bm
   WHERE bm.brand_id = _brand_id
     AND bm.is_active
     AND bm.role <> 'client'
     AND bm.user_id = ANY (v_ids)
  ON CONFLICT (thread_id, user_id) DO NOTHING;

  -- Super Admin sem membership explícita (autor) também entra.
  IF NOT EXISTS (
    SELECT 1 FROM public.message_thread_participants p
     WHERE p.thread_id = v_thread AND p.user_id = v_user
  ) AND public.is_super_admin(v_user) THEN
    INSERT INTO public.message_thread_participants (thread_id, user_id, role_in_thread)
    VALUES (v_thread, v_user, 'team')
    ON CONFLICT (thread_id, user_id) DO NOTHING;
  END IF;

  -- Contatos do portal apenas em conversa de cliente compartilhada.
  IF v_scope = 'client' AND v_visibility = 'shared_with_client' AND v_client IS NOT NULL THEN
    INSERT INTO public.message_thread_participants (thread_id, user_id, role_in_thread)
    SELECT v_thread, cm.user_id, 'portal_client'
      FROM public.client_members cm
     WHERE cm.client_id = v_client
       AND cm.role = 'portal_client'
       AND cm.user_id = ANY (v_ids)
    ON CONFLICT (thread_id, user_id) DO NOTHING;
  END IF;

  RETURN v_thread;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_message_thread(uuid, text, text, uuid, uuid, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_message_thread(uuid, text, text, uuid, uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_message_thread(uuid, text, text, uuid, uuid, text, uuid[]) TO service_role;
-- Adiciona vínculo real entre um post do Kanban e as contas sociais (social_connections)
-- que ele deve publicar. Antes, "posts.channels" armazenava apenas strings genéricas
-- ("instagram", "tiktok"...) — não permitia saber QUAL conta Instagram do cliente
-- deveria ser usada. Este campo materializa a intenção como IDs de conexão.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS target_connection_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.posts.target_connection_ids IS
  'IDs de social_connections que este post deve publicar. Referenciados por aplicação (validados por brand/cliente no server function).';

CREATE INDEX IF NOT EXISTS idx_posts_target_connection_ids
  ON public.posts USING GIN (target_connection_ids);
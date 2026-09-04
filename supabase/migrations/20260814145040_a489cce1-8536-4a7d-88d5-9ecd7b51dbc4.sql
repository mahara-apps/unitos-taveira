DROP INDEX IF EXISTS public.uq_social_conn_brand_channel_ativa_nullclient;
DROP INDEX IF EXISTS public.uq_social_conn_client_channel_ativa;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_conn_brand_provider_external
  ON public.social_connections (brand_id, provider, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_social_accounts_client_conn
  ON public.client_social_accounts (client_id, connection_id);
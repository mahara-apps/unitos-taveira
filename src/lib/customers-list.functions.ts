import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Usado EXCLUSIVAMENTE pela tela Clientes (lista) para exibir a coluna
 * "Canais". Somente leitura: consulta `client_social_accounts` (fonte de
 * verdade do vínculo cliente↔canal) sem alterar a arquitetura de canais.
 */
export type ClientChannelBadge = {
  connectionId: string;
  channel: string;
  label: string;
  status: string;
};

export const listBrandClientChannelsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ brandId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<Record<string, ClientChannelBadge[]>> => {
    const [linksRes, connsRes] = await Promise.all([
      context.supabase
        .from("client_social_accounts")
        .select("client_id, connection_id")
        .eq("brand_id", data.brandId),
      context.supabase
        .from("social_connections")
        .select("id, channel, external_name, account_username, status")
        .eq("brand_id", data.brandId),
    ]);
    if (linksRes.error) throw new Error(linksRes.error.message);
    if (connsRes.error) throw new Error(connsRes.error.message);

    const byId = new Map(
      (connsRes.data ?? []).map((c) => [
        c.id as string,
        {
          connectionId: c.id as string,
          channel: (c.channel ?? "") as string,
          label: (c.external_name ?? c.account_username ?? c.channel ?? "—") as string,
          status: (c.status ?? "active") as string,
        },
      ]),
    );

    const out: Record<string, ClientChannelBadge[]> = {};
    for (const link of linksRes.data ?? []) {
      const conn = byId.get(link.connection_id as string);
      if (!conn) continue;
      const key = link.client_id as string;
      (out[key] ??= []).push(conn);
    }
    return out;
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PortalAccess = {
  /** Tem vínculo de portal (client_members.role = 'portal_client'). */
  isPortalUser: boolean;
  /** Tem vínculo interno de equipe (brand_members). */
  isTeamMember: boolean;
  /** Clientes que este usuário acessa como cliente final. */
  clientIds: string[];
};

/**
 * Fase A — identifica se o usuário autenticado é usuário de portal, de equipe,
 * ou ambos. Usado pelo gate do layout `_authenticated` para mandar cliente final
 * ao portal em vez de mostrar a UI interna da agência.
 */
export const getMyPortalAccessFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortalAccess> => {
    const { supabase, userId } = context;

    const [{ data: portalRows, error: portalErr }, { data: teamRows, error: teamErr }] =
      await Promise.all([
        supabase
          .from("client_members")
          .select("client_id")
          .eq("user_id", userId)
          .eq("role", "portal_client"),
        supabase.from("brand_members").select("brand_id").eq("user_id", userId).limit(1),
      ]);

    if (portalErr) throw portalErr;
    if (teamErr) throw teamErr;

    const clientIds = (portalRows ?? []).map((r) => r.client_id);
    return {
      isPortalUser: clientIds.length > 0,
      isTeamMember: (teamRows ?? []).length > 0,
      clientIds,
    };
  });

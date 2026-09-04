import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RpcClient } from "@/lib/access-guard";
import { assertSuperAdmin } from "@/lib/super-admin";

type Kind = "logo_light" | "logo_dark" | "icon" | "logo_login";

const COLUMN: Record<Kind, "logo_url" | "logo_dark_url" | "icon_url" | "login_logo_url"> = {
  logo_light: "logo_url",
  logo_dark: "logo_dark_url",
  icon: "icon_url",
  logo_login: "login_logo_url",
};

/**
 * Identidade visual institucional pertence à INSTALAÇÃO (singleton
 * `public.installation`), não ao workspace: sidebar, favicon e tela de login
 * mostram a mesma marca para todos os workspaces da instância, e a identidade
 * do workspace A nunca vaza para o workspace B.
 *
 * Autoridade: SOMENTE Super Admin escreve (`canAccessVisualIdentity` na UI +
 * `assertSuperAdmin` aqui + policy no banco). Leitura segue aberta a qualquer
 * usuário autenticado, pois alimenta sidebar/login.
 */
async function assertIdentityWriter(supabase: SupabaseClient, userId: string) {
  await assertSuperAdmin(supabase as unknown as RpcClient, userId);
}

export const updateBrandBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { brandId: string; kind: Kind; storagePath: string | null }) => {
    if (!input?.brandId) throw new Error("brandId required");
    if (!["logo_light", "logo_dark", "icon", "logo_login"].includes(input.kind))
      throw new Error("invalid kind");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIdentityWriter(supabase, userId);
    const { updateInstallationSettings } = await import("@/lib/installation-settings.server");
    await updateInstallationSettings({ [COLUMN[data.kind]]: data.storagePath });
    return { ok: true };
  });

export const getBrandBranding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { brandId: string }) => {
    if (!input?.brandId) throw new Error("brandId required");
    return input;
  })
  .handler(async () => {
    const { getInstallationSettings } = await import("@/lib/installation-settings.server");
    const s = await getInstallationSettings();
    return {
      logo_light: s.logoUrl,
      logo_dark: s.logoDarkUrl,
      icon: s.iconUrl,
      logo_login: s.loginLogoUrl,
    };
  });

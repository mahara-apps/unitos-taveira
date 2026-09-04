import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperAdmin } from "@/lib/super-admin";
import type { RpcClient } from "@/lib/access-guard";

/**
 * Tipo de App Meta da INSTALAÇÃO — exclusivo de Super Admin.
 * A autorização real é dupla: `assertSuperAdmin` aqui e a policy do singleton
 * `public.installation_meta_app` no banco. Nenhum outro papel (Owner, Admin,
 * Manager, User) lê ou escreve esta configuração.
 */
export const getMetaAppSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase as unknown as RpcClient, context.userId);
    const { getMetaAppSettings } = await import("./app-config.server");
    return getMetaAppSettings();
  });

const SaveInput = z.object({
  appType: z.enum(["unitos", "client"]),
  appId: z.string().max(120).nullable().optional(),
  /** `undefined` mantém o segredo atual; string vazia apaga. */
  appSecret: z.string().max(500).nullable().optional(),
  businessConfigId: z.string().max(120).nullable().optional(),
});

export const saveMetaAppSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase as unknown as RpcClient, context.userId);
    const { saveMetaAppSettings, getMetaAppSettings } = await import("./app-config.server");

    if (data.appType === "client") {
      const current = await getMetaAppSettings();
      const willHaveAppId = (data.appId ?? current.client.appId)?.trim();
      const willHaveSecret =
        data.appSecret !== undefined ? !!data.appSecret?.trim() : current.client.hasSecret;

      if (!willHaveAppId || !willHaveSecret) {
        throw new Error(
          "Informe o App ID e o App Secret do App Meta do cliente para usar este modo.",
        );
      }
    }

    // O App oficial do Unitos só é editável na instalação MASTER. Em uma
    // instalação cliente ele chega pronto pelo provisionamento: aqui apenas o
    // modo pode ser alternado, nunca as credenciais oficiais.
    const current = await getMetaAppSettings();
    const patch =
      data.appType === "unitos" && !current.officialEditable
        ? { appType: "unitos" as const }
        : data;

    await saveMetaAppSettings({ ...patch, actorId: context.userId });
    return getMetaAppSettings();
  });

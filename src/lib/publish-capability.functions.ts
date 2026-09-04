import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Capacidade de publicação por destino (blindagem Meta).
 *
 * Nunca considera `status = active` como "pronto para publicar": valida a
 * cadeia cliente → vínculo → conexão → canal → target → token → granular
 * scope do target. Fail closed, sem fallback entre contas/clientes.
 */

export type DestinationReadiness = {
  connectionId: string;
  channel: string;
  publishReady: boolean;
  code: string;
  message: string;
  deterministic: boolean;
  action: "none" | "reconnect" | "relink" | "retry_later";
  authorizedTargets: string[];
  externalAccountId: string | null;
  checkedAt: string;
};

const Input = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  connectionIds: z.array(z.string().uuid()).max(30).default([]),
  force: z.boolean().optional(),
});

export const checkDestinationsReadinessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<DestinationReadiness[]> => {
    if (data.connectionIds.length === 0) return [];
    const { resolvePublishTarget } = await import("@/lib/meta/publish-capability.server");
    const out: DestinationReadiness[] = [];
    for (const connectionId of Array.from(new Set(data.connectionIds))) {
      const { capability, connection } = await resolvePublishTarget(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId ?? null,
        connectionId,
        force: data.force,
      });
      out.push({
        connectionId,
        channel: connection?.channel ?? "unknown",
        publishReady: capability.publishReady,
        code: capability.code,
        message: capability.message,
        deterministic: capability.deterministic,
        action: capability.action,
        authorizedTargets: capability.authorizedTargets,
        externalAccountId: capability.externalAccountId,
        checkedAt: capability.checkedAt,
      });
    }
    return out;
  });

export const revalidateConnectionCapabilityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
        connectionId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<DestinationReadiness> => {
    const { resolvePublishTarget } = await import("@/lib/meta/publish-capability.server");
    const { capability, connection } = await resolvePublishTarget(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId ?? null,
      connectionId: data.connectionId,
      force: true,
    });
    return {
      connectionId: data.connectionId,
      channel: connection?.channel ?? "unknown",
      publishReady: capability.publishReady,
      code: capability.code,
      message: capability.message,
      deterministic: capability.deterministic,
      action: capability.action,
      authorizedTargets: capability.authorizedTargets,
      externalAccountId: capability.externalAccountId,
      checkedAt: capability.checkedAt,
    };
  });

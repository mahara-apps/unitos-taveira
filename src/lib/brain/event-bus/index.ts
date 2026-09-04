// ⚠️ Brain Event Bus — publica eventos no barramento interno do Brain.
// Este é o ÚNICO caminho autorizado para inserir em `brain_events` a partir
// da plataforma. Módulos externos devem consumir via `brain.events.publish()`.
import type { BrainContext, BrainEventInput } from "../core";
import { waitUntil } from "@/lib/wait-until.server";

// FASE 10E.2 — campos de identidade/autoridade nunca trafegam no payload de evento:
// nada aqui pode ser reinterpretado como fonte de verdade de autorização.
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "role","roles","app_role","app_roles","access_role","is_super_admin","super_admin",
  "is_admin","actor_id","actor","auth","auth_uid","uid","claims","jwt","token","tokens",
  "access_token","refresh_token","id_token","api_key","apikey","authorization","bearer",
  "password","secret","service_role","permissions","scopes","scope_override","impersonate",
]);

export function sanitizeEventPayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function publish(ctx: BrainContext, event: BrainEventInput): Promise<void> {
  // Fire-and-forget: o Event Bus é best-effort e NUNCA deve bloquear a resposta.
  // `waitUntil` mantém o isolate vivo no Worker até o insert concluir.
  waitUntil(
    (async () => {
      const { error } = await ctx.supabase.from("brain_events").insert({
        brand_id: event.brand_id,
        client_id: event.client_id ?? null,
        source_module: event.source_module,
        event_type: event.event_type,
        // FASE 10E.2: ator sempre derivado da identidade autenticada do contexto.
        // Nunca do payload do chamador. Sem sessão (worker/service_role) => evento de sistema.
        actor_id: ctx.userId || null,
        entity_type: event.entity_type ?? null,
        entity_id: event.entity_id ?? null,
        payload: sanitizeEventPayload(event.payload),
      });
      if (error) console.error("[brain.events.publish]", error.message);
    })(),
  );
}

export async function list(
  ctx: BrainContext,
  opts: { limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const q = ctx.supabase
    .from("brain_events")
    .select("id, brand_id, client_id, source_module, event_type, actor_id, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  const { data } = ctx.brandId ? await q.eq("brand_id", ctx.brandId) : await q;
  return (data ?? []) as Array<Record<string, unknown>>;
}

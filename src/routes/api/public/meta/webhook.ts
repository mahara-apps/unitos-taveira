import { createFileRoute } from "@tanstack/react-router";
import {
  forwardMetaWebhook,
  isForwardedWebhook,
  loadRegisteredInstallationPeers,
  mergePeers,
  parseInstallationPeers,
} from "@/lib/meta/installation.server";
import { readRuntimeEnv } from "@/lib/runtime-env.server";


/**
 * Meta Webhooks — single endpoint that receives events for both `page`
 * (Facebook) and `instagram` products and dispatches to the right brand
 * by cross-referencing `social_connections` (channel + external_id).
 *
 * Configure in Meta App Dashboard:
 *   Callback URL: https://unitos.lovable.app/api/public/meta/webhook
 *   Verify token: value of META_WEBHOOK_VERIFY_TOKEN
 *   Subscribe products: "Page" and "Instagram" (feed/messages/mentions...)
 */
export const Route = createFileRoute("/api/public/meta/webhook")({
  server: {
    handlers: {
      // Meta subscription verification handshake.
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const expected = readRuntimeEnv("META_WEBHOOK_VERIFY_TOKEN");
        if (!expected) return new Response("Webhook not configured", { status: 500 });
        if (mode === "subscribe" && token === expected && challenge) {
          return new Response(challenge, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        // Segredo do App Meta EM USO nesta instalação (oficial do Unitos ou
        // App próprio do cliente) — a assinatura precisa bater com ele.
        let appSecret: string | null = null;
        try {
          const { resolveMetaAppCredentials } = await import("@/lib/meta/app-config.server");
          appSecret = (await resolveMetaAppCredentials()).appSecret;
        } catch {
          appSecret = null;
        }
        if (!appSecret) return new Response("Not configured", { status: 500 });

        // 1) Verify X-Hub-Signature-256 against the RAW body.
        const signature = request.headers.get("x-hub-signature-256") ?? "";
        const raw = await request.text();
        const ok = await verifySignature(appSecret, raw, signature);
        if (!ok) return new Response("Invalid signature", { status: 401 });

        // 2) Parse and route by `object` — "page" = Facebook, "instagram" = IG.
        type Entry = {
          id: string;
          time?: number;
          changes?: Array<{ field: string; value: unknown }>;
          messaging?: unknown[];
        };
        let payload: { object?: string; entry?: Entry[] };
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const object = payload.object;
        const channel: "facebook" | "instagram" | null =
          object === "page" ? "facebook" : object === "instagram" ? "instagram" : null;
        if (!channel) {
          // Unknown product — ack but ignore.
          return new Response("ok", { status: 200 });
        }

        const entries = payload.entry ?? [];
        if (entries.length === 0) return new Response("ok", { status: 200 });

        // 3) Resolve each entry's `id` (Page ID or IG Business ID) to a
        //    social_connections row so we know which brand it belongs to.
        const externalIds = Array.from(new Set(entries.map((e) => String(e.id))));
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: matches, error } = await supabaseAdmin
          .from("social_connections")
          .select("id, brand_id, channel, external_id")
          .eq("provider", "meta")
          .eq("channel", channel)
          .in("external_id", externalIds);
        if (error) {
          console.error("[meta.webhook] lookup failed", error);
          // Still 200 — Meta retries aggressively on 5xx.
          return new Response("ok", { status: 200 });
        }

        const byExternalId = new Map((matches ?? []).map((m) => [m.external_id, m]));

        // 4) Enqueue each matched entry no Event Bus do Brain (regra Brain-First:
        //    nenhum acesso direto a tabelas brain_* fora de src/lib/brain/**).
        const events = entries
          .map((entry) => {
            const match = byExternalId.get(String(entry.id));
            if (!match) return null;
            return {
              brand_id: match.brand_id,
              source_module: "meta_webhook",
              event_type: `meta.${channel}.${detectEventType(entry)}`,
              entity_type: "social_connection",
              entity_id: match.id,
              payload: {
                object,
                channel,
                external_id: String(entry.id),
                connection_id: match.id,
                entry,
              } as Record<string, unknown>,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        // 4b) Multi-installation: a single Meta App has ONE webhook Callback
        //     URL per product, so entries that belong to a sibling installation
        //     land here. Replay the *verified* raw payload to the trusted peers
        //     configured in META_WEBHOOK_PEERS (infrastructure config only).
        const unmatched = externalIds.filter((id) => !byExternalId.has(id));
        if (unmatched.length > 0 && !isForwardedWebhook(request.headers)) {
          const selfOrigin = new URL(request.url).origin;
          const peers = mergePeers(
            parseInstallationPeers(readRuntimeEnv("META_WEBHOOK_PEERS"), selfOrigin),
            // Instalações registradas no Installation Manager (MASTER).
            await loadRegisteredInstallationPeers(selfOrigin),
          );
          if (peers.length > 0) {
            const outcomes = await forwardMetaWebhook({
              rawBody: raw,
              signature,
              peers,
              contentType: request.headers.get("content-type"),
            });
            for (const o of outcomes) {
              if (!o.ok) {
                console.warn(
                  `[meta.webhook] forward failed target=${o.target} status=${o.status ?? "-"} error=${o.error ?? "-"}`,
                );
              }
            }
          }
        }

        if (events.length > 0) {
          const { brain } = await import("@/lib/brain/api");
          // Contexto de sistema: webhook não tem usuário autenticado.
          const ctx = { supabase: supabaseAdmin, brandId: null, userId: "" };
          for (const ev of events) {
            await brain.events.publish(ctx, ev);
          }
        } else {
          console.warn(
            `[meta.webhook] no matching connection for channel=${channel} ids=${externalIds.join(",")}`,
          );
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});

function detectEventType(entry: {
  changes?: Array<{ field: string }>;
  messaging?: unknown[];
}): string {
  if (entry.messaging && entry.messaging.length > 0) return "message";
  const field = entry.changes?.[0]?.field;
  return field ? String(field).replace(/[^a-z0-9_]/gi, "_") : "unknown";
}

async function verifySignature(
  appSecret: string,
  body: string,
  signatureHeader: string,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

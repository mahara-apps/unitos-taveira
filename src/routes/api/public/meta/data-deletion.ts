import { createFileRoute } from "@tanstack/react-router";
import {
  parseMetaSignedRequest,
  buildConfirmationCode,
  confirmationUrl,
} from "@/lib/meta/signed-request.server";

/**
 * Meta Data Deletion Request Callback.
 * Configure in Meta App Dashboard → App Settings → Basic:
 *   Data Deletion Request URL: https://unitos.sejaumpartner.com/api/public/meta/data-deletion
 *
 * Meta POSTs `signed_request=<sig>.<payload>` (application/x-www-form-urlencoded).
 * Response MUST be JSON with `{ url, confirmation_code }` per Meta spec.
 */
export const Route = createFileRoute("/api/public/meta/data-deletion")({
  server: {
    handlers: {
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
        if (!appSecret) return jsonResp({ error: "not_configured" }, 500);

        const signed = await extractSignedRequest(request);
        if (!signed) return jsonResp({ error: "missing_signed_request" }, 400);

        const parsed = await parseMetaSignedRequest(signed, appSecret);
        if (!parsed) return jsonResp({ error: "invalid_signature" }, 401);

        const metaUserId = String(parsed.user_id ?? "");
        if (!metaUserId) return jsonResp({ error: "missing_user_id" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Delete every Meta connection owned by this Meta user, and any
        // pending OAuth portfolio session rows.
        const { data: deleted } = await supabaseAdmin
          .from("social_connections")
          .delete()
          .eq("provider", "meta")
          .eq("owner_external_id", metaUserId)
          .select("id");

        await supabaseAdmin.from("meta_oauth_sessions").delete().eq("meta_user_id", metaUserId);

        const confirmationCode = buildConfirmationCode("del", metaUserId);
        await supabaseAdmin.from("meta_compliance_events").insert({
          event_type: "data_deletion",
          meta_user_id: metaUserId,
          confirmation_code: confirmationCode,
          status: "completed",
          affected_connections: deleted?.length ?? 0,
          payload: parsed as never,
        });

        return jsonResp({
          url: confirmationUrl(confirmationCode),
          confirmation_code: confirmationCode,
        });
      },
    },
  },
});

async function extractSignedRequest(request: Request): Promise<string | null> {
  const ctype = request.headers.get("content-type") ?? "";
  if (ctype.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(await request.text()).get("signed_request");
  }
  if (ctype.includes("multipart/form-data")) {
    const form = await request.formData();
    const v = form.get("signed_request");
    return typeof v === "string" ? v : null;
  }
  if (ctype.includes("application/json")) {
    try {
      const body = (await request.json()) as { signed_request?: string };
      return body.signed_request ?? null;
    } catch {
      return null;
    }
  }
  const raw = await request.text();
  if (!raw) return null;
  return new URLSearchParams(raw).get("signed_request");
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

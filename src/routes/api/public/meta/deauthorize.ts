import { createFileRoute } from "@tanstack/react-router";
import {
  parseMetaSignedRequest,
  buildConfirmationCode,
  confirmationUrl,
} from "@/lib/meta/signed-request.server";

/**
 * Meta Deauthorize Callback.
 * Configure in Meta App Dashboard → App Settings → Basic:
 *   Deauthorize Callback URL: https://unitos.sejaumpartner.com/api/public/meta/deauthorize
 *
 * Meta POSTs `signed_request=<sig>.<payload>` (application/x-www-form-urlencoded)
 * when a user removes the app from their Facebook account. We verify the HMAC
 * signature with META_APP_SECRET, then revoke all social_connections that
 * belong to that Meta user (owner_external_id) by marking them `revoked`
 * and wiping any stored token so they cannot be used again.
 */
export const Route = createFileRoute("/api/public/meta/deauthorize")({
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

        // Revoke every Meta connection owned by this Meta user.
        const { data: affected } = await supabaseAdmin
          .from("social_connections")
          .update({
            status: "revoked",
            last_error: "User deauthorized the app on Facebook",
            access_token_ciphertext: "",
            refresh_token_ciphertext: null,
            token_expires_at: null,
          })
          .eq("provider", "meta")
          .eq("owner_external_id", metaUserId)
          .select("id");

        // Also drop any pending OAuth session rows for this Meta user.
        await supabaseAdmin.from("meta_oauth_sessions").delete().eq("meta_user_id", metaUserId);

        const confirmationCode = buildConfirmationCode("deauth", metaUserId);
        await supabaseAdmin.from("meta_compliance_events").insert({
          event_type: "deauthorize",
          meta_user_id: metaUserId,
          confirmation_code: confirmationCode,
          status: "processed",
          affected_connections: affected?.length ?? 0,
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
    const form = new URLSearchParams(await request.text());
    return form.get("signed_request");
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
  // Fallback: try text as urlencoded.
  const raw = await request.text();
  if (!raw) return null;
  const form = new URLSearchParams(raw);
  return form.get("signed_request");
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

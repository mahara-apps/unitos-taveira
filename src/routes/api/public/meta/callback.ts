import { createFileRoute } from "@tanstack/react-router";
import { readRuntimeEnv } from "@/lib/runtime-env.server";

/**
 * Meta OAuth landing (public). Meta redirects the browser here with
 * `?code=...&state=...`. State is an HMAC-signed token — no DB row required.
 *
 * We DO NOT auto-link a connection here anymore. Instead we capture the
 * complete portfolio (every Page + IG the user administers) into a short-lived
 * row in `meta_oauth_sessions` and hand its id back to the popup opener so
 * the "Meta Account Selector" dialog can let the user pick which accounts to
 * bind to the current brand.
 */
export const Route = createFileRoute("/api/public/meta/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const stateToken = url.searchParams.get("state");
        const errorReason =
          url.searchParams.get("error_reason") ||
          url.searchParams.get("error_description") ||
          url.searchParams.get("error");

        if (errorReason) {
          return htmlResult({ ok: false, error: metaOAuthErrorMessage(errorReason) });
        }
        if (!code || !stateToken) return htmlResult({ ok: false, error: "Missing code or state" });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { MetaProvider, MetaGraphError, verifyOAuthState } =
          await import("@/lib/meta/provider.server");
        const { encryptCredential } = await import("@/lib/credentials-crypto.server");

        // 1) Verify signed state (CSRF + brand/user context).
        let state: Awaited<ReturnType<typeof verifyOAuthState>>;
        try {
          state = await verifyOAuthState(stateToken);
        } catch (err) {
          return htmlResult({
            ok: false,
            error: err instanceof Error ? err.message : "Invalid state",
          });
        }

        try {
          const provider = new MetaProvider({ origin: url.origin });
          const { getMetaScopesForChannel } = await import("@/lib/meta/provider.server");
          const requestedScopes = getMetaScopesForChannel(state.channel ?? null);

          // 2) code -> short-lived -> long-lived user token
          let stage = "troca do código de autorização";
          try {
            const shortLived = await provider.exchangeCode(code);
            stage = "criação do token de longa duração";
            const longLived = await provider.exchangeForLongLivedUserToken(shortLived.accessToken);

            // 3) Identify Meta user + granted scopes (NO Graph scans here — those
            //    are lazy-loaded on demand when the user opens the portfolio
            //    dialog, to stay well under Meta's per-app rate limits).
            stage = "leitura da conta Meta";
            const me = await provider.getMe(longLived.accessToken);
            stage = "leitura das permissões concedidas";
            const grantedScopes = await provider.listGrantedPermissions(longLived.accessToken);

            const missingScopes = requestedScopes.filter((s) => !grantedScopes.includes(s));

            // 4) Persist ONLY the user token + identity in a short-lived session
            //    row. Portfolio arrays start empty and are populated lazily by
            //    `getMetaPortfolio` when the dialog is actually opened.
            stage = "criação da sessão de seleção de contas";
            const userTokenCiphertext = await encryptCredential(longLived.accessToken);
            const { data: sessionRow, error: sessErr } = await supabaseAdmin
              .from("meta_oauth_sessions")
              .insert({
                brand_id: state.brandId,
                user_id: state.userId,
                meta_user_id: me.id,
                meta_user_name: me.name ?? null,
                meta_user_email: me.email ?? null,
                user_token_ciphertext: userTokenCiphertext,
                user_token_expires_at: longLived.expiresAt?.toISOString() ?? null,
                scopes: grantedScopes,
                requested_scopes: requestedScopes,
                // Single-use marker: the unique index on `state_nonce` makes a
                // replayed `state` fail here instead of minting a new session.
                state_nonce: state.nonce,
                pages: [] as unknown as import("@/integrations/supabase/types").Json,
                threads_accounts: [] as unknown as import("@/integrations/supabase/types").Json,
                ad_accounts: [] as unknown as import("@/integrations/supabase/types").Json,
              })
              .select("id")
              .single();
            if (sessErr) {
              if ((sessErr as { code?: string }).code === "23505") {
                return htmlResult({
                  ok: false,
                  error:
                    "Esta autorização da Meta já foi utilizada. Inicie a conexão novamente pela Central de canais.",
                });
              }
              throw sessErr;
            }


            return htmlResult({
              ok: true,
              message:
                "Login Meta concluído. Abra o seletor de contas para carregar seu portfólio.",
              redirectTo: appendSessionParam(
                state.redirectTo ?? "/connections",
                sessionRow.id,
                state.channel ?? null,
              ),
              sessionId: sessionRow.id,
              channel: state.channel ?? null,
              missingScopes,
            });
          } catch (err) {
            console.error(`[meta/callback] falha na etapa: ${stage}`, err);
            throw err;
          }
        } catch (err) {
          console.error("[meta/callback] falha ao concluir OAuth", err);
          const msg =
            err instanceof MetaGraphError
              ? `Meta: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Erro desconhecido";
          return htmlResult({ ok: false, error: msg });
        }
      },
    },
  },
});

function htmlResult(result: {
  ok: boolean;
  message?: string;
  error?: string;
  redirectTo?: string;
  sessionId?: string;
  channel?: string | null;
  missingScopes?: string[];
}): Response {
  const target = result.redirectTo ?? "/connections";
  /**
   * Origem confiável para o `postMessage`: a URL canônica registrada em
   * META_REDIRECT_URI é a própria instalação, então usamos o origin dela em vez
   * do curinga "*" (que entregaria a mensagem a qualquer opener).
   */
  let targetOrigin = "/";
  try {
    const configured = readRuntimeEnv("META_REDIRECT_URI") ?? readRuntimeEnv("PUBLIC_APP_URL");
    if (configured) targetOrigin = new URL(configured).origin;
  } catch {
    targetOrigin = "/";
  }
  const title = result.ok ? "Meta conectada" : "Falha ao conectar Meta";
  const detail = result.ok
    ? (result.message ?? "Conexão concluída.")
    : (result.error ?? "Tente novamente.");
  const body = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b0e; color: #f4f4f5; }
  .card { max-width: 420px; padding: 32px; border: 1px solid #27272a; border-radius: 16px; background: #111114; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: #a1a1aa; font-size: 14px; margin: 0 0 20px; }
  a { display: inline-block; padding: 10px 16px; background: ${result.ok ? "#22c55e" : "#ef4444"}; color: #0b0b0e; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px; }
</style>
</head><body>
<div class="card">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(detail)}</p>
  <a href="${escapeAttr(target)}">Voltar ao app</a>
</div>
<script>
  try {
    if (window.opener) {
      // A origem do opener pode ser o preview ou o domínio publicado, que não
      // necessariamente coincide com META_REDIRECT_URI. Entregamos a mensagem
      // para as origens conhecidas (nunca "*").
      var origins = [${JSON.stringify(targetOrigin)}, window.location.origin, document.referrer ? new URL(document.referrer).origin : ""]
        .filter(function (o, i, a) { return o && o.indexOf("http") === 0 && a.indexOf(o) === i; });
      var payloads = [${JSON.stringify({ source: "meta-oauth", ok: result.ok, error: result.error, message: result.message, sessionId: result.sessionId ?? null, channel: result.channel ?? null })}${
        result.missingScopes && result.missingScopes.length > 0
          ? `, ${JSON.stringify({ source: "meta-oauth", type: "missing-scopes", scopes: result.missingScopes })}`
          : ""
      }];
      origins.forEach(function (origin) {
        payloads.forEach(function (payload) {
          try { window.opener.postMessage(payload, origin); } catch (e) {}
        });
      });
      setTimeout(() => window.close(), 250);
    } else {
      setTimeout(() => { window.location.href = ${JSON.stringify(target)}; }, 1500);
    }
  } catch (e) {}
</script>
</body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Preserve window.opener across the Facebook cross-origin hop so
      // postMessage back to the app succeeds and the popup can close itself.
      "Cross-Origin-Opener-Policy": "unsafe-none",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function metaOAuthErrorMessage(raw: string): string {
  const value = raw.toLowerCase();
  if (value.includes("user_denied") || value.includes("access_denied")) {
    return "Autorização cancelada na Meta. Para concluir, refaça o login e mantenha as permissões do canal selecionadas.";
  }
  if (value.includes("permissions")) {
    return "A Meta recusou uma ou mais permissões necessárias. Refaça o login e mantenha as permissões do canal selecionadas.";
  }
  return raw;
}

function appendSessionParam(target: string, sessionId: string, channel: string | null): string {
  const sep = target.includes("?") ? "&" : "?";
  const ch = channel ? `&meta_channel=${encodeURIComponent(channel)}` : "";
  return `${target}${sep}meta_session=${encodeURIComponent(sessionId)}${ch}`;
}

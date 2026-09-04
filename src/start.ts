import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { supabase } from "@/integrations/supabase/client";

const AUTH_ERROR_RE = /Unauthorized|Invalid token|No authorization header/i;

function getSafeCurrentPath() {
  if (typeof window === "undefined") return "/dashboard";
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (!current.startsWith("/") || current.startsWith("//")) return "/dashboard";
  if (/^\/(auth|login)(\/|$)/.test(window.location.pathname)) return "/dashboard";
  return current;
}

async function clearInvalidSession() {
  if (typeof window !== "undefined") {
    // Clear storage first. If the server rejects the stale token, Supabase's
    // logout request can itself fail; the browser must not keep rehydrating it.
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key === "supabase.auth.token" || key?.startsWith("sb-")) {
        window.localStorage.removeItem(key);
      }
    }
  }
  void supabase.auth.signOut().catch(() => null);
}

function redirectToLoginWithoutThrowing() {
  if (typeof window === "undefined") return;
  const next = getSafeCurrentPath();
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}

// Client middleware that attaches the Supabase bearer token to every server
// function RPC. Unlike the generated `attachSupabaseAuth`, this one proactively
// refreshes an expired/near-expiry session so long-lived tabs don't start
// failing with "Unauthorized: No authorization header provided" after the
// access token silently expires.
const attachSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  let token = data.session?.access_token;
  const expiresAt = data.session?.expires_at;
  const nearExpiry = expiresAt ? expiresAt * 1000 - Date.now() < 60_000 : false;
  const expired = expiresAt ? expiresAt * 1000 <= Date.now() : false;
  if (!token || nearExpiry) {
    const refreshed = await supabase.auth.refreshSession().catch(() => null);
    const refreshedToken = refreshed?.data.session?.access_token ?? null;
    // Se o refresh falhou e o token atual já expirou, não envie um bearer
    // inválido — o servidor responderia "Unauthorized: Invalid token".
    token = refreshedToken ?? (expired ? undefined : token);
    if (!refreshedToken && expired) {
      await clearInvalidSession();
    }
  }

  // Global middleware must be best-effort: public server functions should
  // still work without a session. Protected functions will be rejected by
  // requireSupabaseAuth and handled below.
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    return await next({ headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!AUTH_ERROR_RE.test(msg)) throw err;

    // Antes de derrubar a sessão: o servidor pode ter recusado um token que
    // acabou de expirar (ou uma corrida com o refresh em outra aba). Tenta
    // UMA vez com um token novo — só então força re-login.
    const refreshed = await supabase.auth.refreshSession().catch(() => null);
    const freshToken = refreshed?.data.session?.access_token ?? null;
    if (freshToken && freshToken !== token) {
      try {
        return await next({ headers: { Authorization: `Bearer ${freshToken}` } });
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (!AUTH_ERROR_RE.test(retryMsg)) throw retryErr;
      }
    }

    // Token rejeitado de fato (ex.: sessão de outro projeto no localStorage,
    // token revogado). Limpa e força re-login.
    await clearInvalidSession();
    redirectToLoginWithoutThrowing();
    if (typeof window !== "undefined") {
      return await new Promise<never>(() => undefined);
    }
    throw err;
  }
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    const errorId = crypto.randomUUID().slice(0, 8);
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const url = new URL(request.url);
    console.error(`[server-error:${errorId}] ${request.method} ${url.pathname}`, error);
    return new Response(renderErrorPage(errorId), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8", "x-error-id": errorId },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));

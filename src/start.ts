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

/**
 * Sessão perdida: em vez de trocar a página na hora (o que apaga formulários
 * em edição), avisamos a UI. Só depois de falhas REAIS e consecutivas — nunca
 * por um timeout do broker de sessão do preview, que responde por
 * postMessage com limite de 2s.
 */
const SESSION_EXPIRED_EVENT = "nx:session-expired";
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;
let consecutiveAuthFailures = 0;
let lastAuthFailureAt = 0;
/** Falhas espaçadas (> 2 min) não somam: tratamos como incidentes isolados. */
const FAILURE_WINDOW_MS = 120_000;

function noteAuthFailure(): number {
  const now = Date.now();
  if (now - lastAuthFailureAt > FAILURE_WINDOW_MS) consecutiveAuthFailures = 0;
  lastAuthFailureAt = now;
  consecutiveAuthFailures += 1;
  return consecutiveAuthFailures;
}

function announceSessionExpired() {
  if (typeof window === "undefined") return;
  const next = getSafeCurrentPath();
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { next } }));
}

/**
 * Renova a sessão tolerando falhas transitórias (rede, timeout de 2s do broker
 * de sessão do preview). Uma tentativa extra com espera curta evita expulsar o
 * usuário por um atraso momentâneo.
 */
const REFRESH_RETRY_DELAYS_MS = [0, 400, 1200];
async function refreshWithBackoff(): Promise<{ access_token: string } | null> {
  for (const delay of REFRESH_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const res = await supabase.auth.refreshSession().catch(() => null);
    const token = res?.data.session?.access_token ?? null;
    if (token) return { access_token: token };
  }
  return null;
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
    const refreshed = await refreshWithBackoff();
    const refreshedToken = refreshed?.access_token ?? null;
    // Se o refresh falhou e o token atual já expirou, não envie um bearer
    // inválido — o servidor responderia "Unauthorized: Invalid token".
    token = refreshedToken ?? (expired ? undefined : token);
    // Importante: NÃO limpar a sessão aqui. Um refresh que falha por rede ou
    // por timeout do broker do preview não significa sessão inválida.
  }

  // Global middleware must be best-effort: public server functions should
  // still work without a session. Protected functions will be rejected by
  // requireSupabaseAuth and handled below.
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    const result = await next({ headers });
    consecutiveAuthFailures = 0;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!AUTH_ERROR_RE.test(msg)) throw err;

    // Antes de derrubar a sessão: o servidor pode ter recusado um token que
    // acabou de expirar (ou uma corrida com o refresh em outra aba). Tenta
    // novamente com um token novo (com backoff) — só então considera falha.
    const refreshed = await refreshWithBackoff();
    const freshToken = refreshed?.access_token ?? null;
    if (freshToken && freshToken !== token) {
      try {
        const retry = await next({ headers: { Authorization: `Bearer ${freshToken}` } });
        consecutiveAuthFailures = 0;
        return retry;
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (!AUTH_ERROR_RE.test(retryMsg)) throw retryErr;
      }
    }

    const failures = noteAuthFailure();
    if (failures < MAX_CONSECUTIVE_AUTH_FAILURES) {
      // Falha isolada: propaga o erro para a chamada (a tela mostra o retry),
      // mas mantém a página e o que estiver em edição.
      throw err;
    }

    // Token rejeitado de fato e de forma repetida (ex.: sessão revogada).
    // Limpa e AVISA a UI — sem trocar a página no meio do trabalho.
    await clearInvalidSession();
    announceSessionExpired();
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

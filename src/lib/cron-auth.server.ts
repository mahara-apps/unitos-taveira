/**
 * Gate único dos endpoints privilegiados sob `/api/public/*` chamados por
 * pg_cron ou schedulers internos.
 *
 * IMPORTANTE: nunca use a chave publicável (`SUPABASE_PUBLISHABLE_KEY` /
 * `SUPABASE_ANON_KEY`) como autenticação — ela vai no bundle do browser e é
 * pública, o que equivale a não ter gate nenhum. O segredo dedicado
 * `CRON_SECRET` só existe no runtime do servidor e no Vault do Postgres
 * (usado pelos jobs do pg_cron).
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Retorna `null` quando a requisição é autorizada, ou a `Response` de erro
 * que o handler deve devolver imediatamente.
 */
export function assertCronRequest(request: Request): Response | null {
  const expected = process.env["CRON_SECRET"]?.trim();
  if (!expected) {
    console.error("[cron] CRON_SECRET ausente no runtime do servidor");
    return new Response(JSON.stringify({ error: "cron_secret_missing" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const provided =
    request.headers.get("x-cron-secret")?.trim() ??
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ??
    "";

  if (!provided || !timingSafeEqual(provided, expected)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return null;
}

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checkPublicRate, clientIp, rateKey } from "@/lib/public-rate-limit.server";

/**
 * Aprovação pública de peça (link enviado ao cliente).
 *
 * Regras estruturais (fase 10F.2):
 * - o contrato público devolve SOMENTE o necessário para a decisão (sem
 *   `client_id`, `script`, `references`, `reference_media` ou IDs internos);
 * - a decisão é executada pela RPC transacional `card_approval_public_decide`,
 *   que valida token, existência/estado da peça e consome o link (anti-replay);
 * - sem CORS amplo: o consumidor é a própria página `/approval/$token`.
 */

function admin() {
  // `SUPABASE_*` is a reserved prefix on Lovable Cloud; external Supabase
  // projects expose the service role under `SB_SERVICE_ROLE_KEY`.
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SB_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase environment variable(s): SUPABASE_URL and/or SB_SERVICE_ROLE_KEY.",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Same-origin only: sem `Access-Control-Allow-Origin`, nenhuma outra app consome esta rota. */
function isForeignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false; // navegação/fetch same-origin não envia Origin em GET
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

function noStore(res: Response) {
  res.headers.set("cache-control", "no-store");
  res.headers.set("vary", "origin");
  return res;
}

const tooMany = (retryAfter: number) =>
  noStore(
    new Response("too many requests", {
      status: 429,
      headers: { "retry-after": String(retryAfter) },
    }),
  );

export const Route = createFileRoute("/api/public/approval/$token")({
  server: {
    handlers: {
      // Sem CORS: preflight de origem externa é recusado.
      OPTIONS: () => noStore(new Response(null, { status: 204 })),

      GET: async ({ request, params }) => {
        if (isForeignOrigin(request)) return noStore(new Response("forbidden", { status: 403 }));
        const db = admin();

        const rate = await checkPublicRate(db, rateKey("approval-get", clientIp(request)), {
          max: 60,
          windowSeconds: 300,
          blockSeconds: 600,
        });
        if (rate.blocked) return tooMany(rate.retryAfter);

        const { data: tok } = await db
          .from("card_approval_tokens")
          .select("id, post_id, expires_at, revoked_at")
          .eq("token", params.token)
          .maybeSingle();
        if (!tok) return noStore(new Response("invalid token", { status: 404 }));
        if (tok.revoked_at) return noStore(new Response("token revoked", { status: 410 }));
        if (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now())
          return noStore(new Response("token expired", { status: 410 }));

        const { data: post } = await db
          .from("posts")
          .select(
            "title, copy, format, channels, scheduled_at, cover_url, client_briefing, review_status, clients:client_id(name)",
          )
          .eq("id", tok.post_id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!post) return noStore(new Response("post not found", { status: 404 }));

        const clientRel = (post as { clients?: { name: string } | { name: string }[] | null })
          .clients;
        const clientRow = Array.isArray(clientRel) ? (clientRel[0] ?? null) : (clientRel ?? null);

        return noStore(
          Response.json({
            post: {
              title: post.title,
              copy: post.copy,
              format: post.format,
              channels: post.channels,
              scheduled_at: post.scheduled_at,
              cover_url: post.cover_url,
              client_briefing: post.client_briefing,
              review_status: post.review_status,
            },
            client: clientRow ? { name: clientRow.name } : null,
            token: { expires_at: tok.expires_at },
          }),
        );
      },

      POST: async ({ request, params }) => {
        if (isForeignOrigin(request)) return noStore(new Response("forbidden", { status: 403 }));

        const body = (await request.json().catch(() => ({}))) as {
          verb?: string;
          comment?: string;
        };
        const verb = body.verb;
        if (verb !== "approved" && verb !== "changes_requested")
          return noStore(new Response("invalid verb", { status: 400 }));

        const db = admin();
        const rate = await checkPublicRate(db, rateKey("approval-post", clientIp(request)), {
          max: 10,
          windowSeconds: 300,
          blockSeconds: 900,
        });
        if (rate.blocked) return tooMany(rate.retryAfter);

        const { data, error } = await db.rpc(
          "card_approval_public_decide" as never,
          {
            _token: params.token,
            _verb: verb,
            _comment: body.comment?.slice(0, 2000) ?? null,
            _ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            _ua: request.headers.get("user-agent") ?? null,
          } as never,
        );
        if (error) return noStore(new Response("decision failed", { status: 500 }));

        const result = (data ?? {}) as { ok?: boolean; reason?: string; status?: number };
        if (!result.ok)
          return noStore(
            new Response(result.reason ?? "unavailable", { status: result.status ?? 410 }),
          );

        return noStore(Response.json({ ok: true }));
      },
    },
  },
});

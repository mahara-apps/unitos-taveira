import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rate limit das SUPERFÍCIES PÚBLICAS (fase 10F.2).
 *
 * Reutiliza a infraestrutura já existente do Portal (`public.portal_rate_limit`)
 * através da função `public.public_surface_rate_hit`, executável apenas por
 * `service_role`. Não há Redis nem infraestrutura externa.
 *
 * Chave: `<escopo>:<sha256(ip + salt)>` (IP nunca é persistido em claro).
 * Quando o limite é excedido, a superfície devolve HTTP 429 com `retry-after`.
 */

export type RateLimitVerdict = { blocked: boolean; retryAfter: number };

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export function rateKey(scope: string, ip: string): string {
  const salt = process.env["CRON_SECRET"] ?? "unitos-public-surface";
  return `${scope}:${createHash("sha256").update(`${ip}|${salt}`).digest("hex").slice(0, 40)}`;
}

export async function checkPublicRate(
  db: SupabaseClient,
  key: string,
  opts: { max: number; windowSeconds: number; blockSeconds: number },
): Promise<RateLimitVerdict> {
  const { data, error } = await db.rpc(
    "public_surface_rate_hit" as never,
    {
      _key: key,
      _max: opts.max,
      _window_seconds: opts.windowSeconds,
      _block_seconds: opts.blockSeconds,
    } as never,
  );
  // Falha de infraestrutura não deve derrubar o fluxo legítimo.
  if (error) return { blocked: false, retryAfter: 0 };
  const row = (data ?? {}) as { blocked?: boolean; retry_after?: number };
  return { blocked: !!row.blocked, retryAfter: row.retry_after ?? 60 };
}

import type { SupabaseClient } from "@supabase/supabase-js";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Assinatura de mídia do portal (token e login usam o mesmo caminho).
 * Buckets são privados: as URLs são geradas server-side.
 */
async function storage(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export async function signPortalMedia(
  path: string,
  bucket = "brand-assets",
): Promise<string | null> {
  const c = await storage();
  const { data } = await c.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl ?? null;
}

export async function signPortalDocument(path: string): Promise<string | null> {
  const c = await storage();
  const { data } = await c.storage.from("brand-documents").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

function refs(reference_media: Json): Array<Record<string, unknown>> {
  return Array.isArray(reference_media) ? (reference_media as Array<Record<string, unknown>>) : [];
}

export async function fillPortalCovers(
  posts: Array<{ cover_url: string | null; reference_media: Json }>,
): Promise<void> {
  for (const p of posts) {
    if (p.cover_url) continue;
    const first = refs(p.reference_media).find((r) => typeof r?.path === "string");
    if (first?.path) {
      const bucket = typeof first.bucket === "string" ? (first.bucket as string) : "brand-assets";
      p.cover_url = await signPortalMedia(first.path as string, bucket);
    }
  }
}

export async function signPortalRefs(
  reference_media: Json,
): Promise<Array<{ url: string; type: string }>> {
  const out = await Promise.all(
    refs(reference_media).map(async (r) => {
      const path = typeof r?.path === "string" ? r.path : null;
      if (!path) return null;
      const bucket = typeof r?.bucket === "string" ? (r.bucket as string) : "brand-assets";
      const url = await signPortalMedia(path, bucket);
      return url ? { url, type: (r?.type as string) ?? "" } : null;
    }),
  );
  return out.filter(Boolean) as Array<{ url: string; type: string }>;
}

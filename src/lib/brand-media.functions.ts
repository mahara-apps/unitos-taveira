import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Brand Media Library — biblioteca de mídia por marca.
 * Arquivos ficam no bucket privado `brand-media` sob o prefixo `<brand_id>/...`.
 */

export type BrandMediaAsset = {
  id: string;
  brandId: string;
  clientId: string | null;
  storagePath: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video" | "other";
  width: number | null;
  height: number | null;
  tags: string[];
  createdAt: string;
  publicUrl: string | null;
};

const BrandInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid().nullish(),
  kind: z.enum(["image", "video", "other"]).optional(),
  limit: z.number().int().min(1).max(200).default(60),
});

function classify(mime: string): "image" | "video" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "other";
}

async function signPath(supabase: any, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("brand-media").createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export const listBrandMediaFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandInput.parse(i))
  .handler(async ({ data, context }): Promise<BrandMediaAsset[]> => {
    let q = context.supabase
      .from("brand_media_assets")
      .select(
        "id, brand_id, client_id, storage_path, name, mime_type, size_bytes, kind, width, height, tags, created_at",
      )
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.clientId) {
      q = q.eq("client_id", data.clientId);
    } else {
      q = q.is("client_id", null);
    }
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const withUrls = await Promise.all(
      (rows ?? []).map(async (r) => ({
        id: r.id,
        brandId: r.brand_id,
        clientId: r.client_id ?? null,
        storagePath: r.storage_path,
        name: r.name,
        mimeType: r.mime_type,
        sizeBytes: Number(r.size_bytes ?? 0),
        kind: r.kind as "image" | "video" | "other",
        width: r.width,
        height: r.height,
        tags: r.tags ?? [],
        createdAt: r.created_at,
        publicUrl: await signPath(context.supabase, r.storage_path),
      })),
    );
    return withUrls;
  });

const RegisterInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid().nullish(),
  storagePath: z.string().min(3),
  name: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().nonnegative().default(0),
  width: z.number().int().nonnegative().nullable().optional(),
  height: z.number().int().nonnegative().nullable().optional(),
  tags: z.array(z.string()).default([]),
});

export const registerBrandMediaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RegisterInput.parse(i))
  .handler(async ({ data, context }): Promise<BrandMediaAsset> => {
    if (!data.storagePath.startsWith(`${data.brandId}/`)) {
      throw new Error("storagePath deve estar sob o prefixo da marca");
    }
    const kind = classify(data.mimeType);
    const { data: row, error } = await context.supabase
      .from("brand_media_assets")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId ?? null,
        uploaded_by: context.userId,
        storage_path: data.storagePath,
        name: data.name,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        width: data.width ?? null,
        height: data.height ?? null,
        kind,
        tags: data.tags,
      })
      .select(
        "id, brand_id, client_id, storage_path, name, mime_type, size_bytes, kind, width, height, tags, created_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id,
      brandId: row.brand_id,
      clientId: row.client_id ?? null,
      storagePath: row.storage_path,
      name: row.name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes ?? 0),
      kind: row.kind as "image" | "video" | "other",
      width: row.width,
      height: row.height,
      tags: row.tags ?? [],
      createdAt: row.created_at,
      publicUrl: await signPath(context.supabase, row.storage_path),
    };
  });

const DeleteInput = z.object({
  id: z.string().uuid(),
  brandId: z.string().uuid(),
});

export const deleteBrandMediaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error: readErr } = await context.supabase
      .from("brand_media_assets")
      .select("id, storage_path")
      .eq("id", data.id)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Mídia não encontrada");
    await context.supabase.storage.from("brand-media").remove([row.storage_path]);
    const { error } = await context.supabase.from("brand_media_assets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SignInput = z.object({
  brandId: z.string().uuid(),
  storagePath: z.string().min(3),
  expiresIn: z
    .number()
    .int()
    .min(60)
    .max(60 * 60 * 24)
    .default(3600),
});

/**
 * Assina uma URL curta para a mídia. Usado pelo composer para entregar um
 * URL público ao publisher (Meta exige URL alcançável).
 */
export const signBrandMediaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SignInput.parse(i))
  .handler(async ({ data, context }) => {
    if (!data.storagePath.startsWith(`${data.brandId}/`)) {
      throw new Error("storagePath fora do escopo da marca");
    }
    const { data: signed, error } = await context.supabase.storage
      .from("brand-media")
      .createSignedUrl(data.storagePath, data.expiresIn);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

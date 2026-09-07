import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePortalSessionScope } from "@/lib/portal-permissions.server";

/**
 * Conversa dos conteúdos em aprovação: mensagens, anexos e marcação de um ponto
 * na imagem (ou instante do vídeo).
 *
 * Ler exige `approvals: ver`; escrever exige `approvals: interagir`. Link sem
 * senha não chega aqui (não há handler por token).
 */

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export type PortalCommentAnchor = {
  /** Índice da mídia comentada. */
  media: number;
  /** Posição relativa na imagem (0–1). */
  x?: number;
  y?: number;
  /** Instante do vídeo, em segundos. */
  t?: number;
};

export type PortalComment = {
  id: string;
  body: string | null;
  authorName: string | null;
  authorSide: "client" | "team";
  anchor: PortalCommentAnchor | null;
  attachments: Array<{ name: string; path: string; mime: string | null; url?: string | null }>;
  createdAt: string;
};

type AnyClient = { from: (table: string) => any };

const ClientIn = z.object({ clientId: z.string().uuid(), postId: z.string().uuid() });

const AnchorIn = z.object({
  media: z.number().int().min(0).max(20),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  t: z.number().min(0).optional(),
});

function decodeBase64(value: string): Uint8Array {
  const raw =
    value.includes(",") && value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(-120) || "anexo";
}

function normalizeAnchor(raw: unknown): PortalCommentAnchor | null {
  if (typeof raw !== "object" || raw === null) return null;
  const parsed = AnchorIn.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const listPortalPostCommentsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientIn.parse(i))
  .handler(async ({ data, context }): Promise<PortalComment[]> => {
    const scope = await resolvePortalSessionScope(context.supabase, data.clientId, "approvals");
    const { data: rows, error } = await (context.supabase as AnyClient)
      .from("post_client_comments")
      .select("id, body, author_name, author_side, anchor, attachments, created_at")
      .eq("client_id", scope.clientId)
      .eq("post_id", data.postId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error((error as { message: string }).message);

    const { signPortalDocument } = await import("@/lib/portal-media.server");
    return Promise.all(
      ((rows ?? []) as Array<Record<string, unknown>>).map(async (row) => {
        const raw = Array.isArray(row["attachments"]) ? (row["attachments"] as unknown[]) : [];
        const attachments = await Promise.all(
          raw
            .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
            .map(async (a) => ({
              name: typeof a["name"] === "string" ? (a["name"] as string) : "anexo",
              path: typeof a["path"] === "string" ? (a["path"] as string) : "",
              mime: typeof a["mime"] === "string" ? (a["mime"] as string) : null,
              url:
                typeof a["path"] === "string" ? await signPortalDocument(a["path"] as string) : null,
            })),
        );
        return {
          id: row["id"] as string,
          body: (row["body"] as string | null) ?? null,
          authorName: (row["author_name"] as string | null) ?? null,
          authorSide: (row["author_side"] as "client" | "team") ?? "client",
          anchor: normalizeAnchor(row["anchor"]),
          attachments: attachments.filter((a) => a.path),
          createdAt: row["created_at"] as string,
        };
      }),
    );
  });

export const addPortalPostCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ClientIn.extend({
      body: z.string().trim().max(4000).optional(),
      anchor: AnchorIn.nullish(),
      attachments: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(180),
            mime: z.string().trim().max(160).nullish(),
            dataBase64: z.string().min(1),
          }),
        )
        .max(5)
        .optional(),
    })
      .refine((v) => Boolean(v.body?.trim()) || (v.attachments?.length ?? 0) > 0, {
        message: "Escreva um comentário ou anexe um arquivo",
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const scope = await resolvePortalSessionScope(
      context.supabase,
      data.clientId,
      "approvals",
      "interact",
    );
    const sb = context.supabase as AnyClient;

    // O conteúdo precisa estar liberado para o portal deste cliente.
    const { data: post } = await sb
      .from("posts")
      .select("id")
      .eq("id", data.postId)
      .eq("client_id", scope.clientId)
      .maybeSingle();
    if (!post) throw new Error("post_not_found");

    const { data: profile } = await sb
      .from("user_profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();

    const attachments: Array<{ name: string; path: string; mime: string | null; size: number }> = [];
    if (data.attachments?.length) {
      const { scopedAdmin } = await import("@/lib/portal-scope.server");
      const admin = await scopedAdmin();
      for (const file of data.attachments) {
        const bytes = decodeBase64(file.dataBase64);
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("attachment_too_large");
        const path = `${scope.brandId}/${scope.clientId}/comentarios/${data.postId}/${Date.now()}-${safeName(file.name)}`;
        const { error: upErr } = await admin.storage
          .from("brand-documents")
          .upload(path, bytes, {
            contentType: file.mime ?? "application/octet-stream",
            upsert: false,
          });
        if (upErr) throw new Error(upErr.message);
        attachments.push({
          name: file.name,
          path,
          mime: file.mime ?? null,
          size: bytes.byteLength,
        });
      }
    }

    const { data: inserted, error } = await sb
      .from("post_client_comments")
      .insert({
        brand_id: scope.brandId,
        client_id: scope.clientId,
        post_id: data.postId,
        author_user_id: context.userId,
        author_name: (profile as { full_name?: string | null } | null)?.full_name ?? null,
        author_side: "client",
        body: data.body?.trim() || null,
        anchor: data.anchor ?? null,
        attachments,
      })
      .select("id")
      .single();
    if (error) throw new Error((error as { message: string }).message);
    return { id: (inserted as { id: string }).id };
  });

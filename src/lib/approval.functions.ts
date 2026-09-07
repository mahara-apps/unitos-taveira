import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ApprovalToken = {
  id: string;
  post_id: string;
  token: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function randomToken(len = 40): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

export const listApprovalTokensFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ApprovalToken[]> => {
    const { data: rows, error } = await context.supabase
      .from("card_approval_tokens")
      .select("id, post_id, token, expires_at, revoked_at, created_at")
      .eq("post_id", data.postId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as ApprovalToken[];
  });

export const createApprovalTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        expiresInDays: z.number().int().min(1).max(90).default(14),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ApprovalToken> => {
    const { data: post, error: pe } = await context.supabase
      .from("posts")
      .select("id, brand_id")
      .eq("id", data.postId)
      .single();
    if (pe || !post) throw pe ?? new Error("post_not_found");

    const expiresAt = new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString();
    const { data: row, error } = await context.supabase
      .from("card_approval_tokens")
      .insert({
        post_id: post.id,
        brand_id: post.brand_id,
        token: randomToken(40),
        expires_at: expiresAt,
        created_by: context.userId,
      })
      .select("id, post_id, token, expires_at, revoked_at, created_at")
      .single();
    if (error) throw error;
    return row as ApprovalToken;
  });

export const revokeApprovalTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ tokenId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("card_approval_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.tokenId);
    if (error) throw error;
    return { ok: true };
  });

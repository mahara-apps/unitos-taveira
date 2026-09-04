/**
 * Notificações de menção (@) em comentários de projeto, job, tarefa e pauta.
 *
 * Best-effort: nunca deve derrubar a criação do comentário. A idempotência vem
 * do índice único parcial de `notifications` via `insertNotificationsDeduped`.
 */
import { insertNotificationsDeduped, notificationDedupeKey } from "@/lib/notifications-dedupe";

type AnyClient = { from: (table: string) => unknown };

export type MentionNotifyInput = {
  brandId: string;
  authorId: string;
  authorName?: string | null;
  mentions: string[];
  /** Id do comentário — base da chave de deduplicação. */
  commentId: string | null;
  title: string;
  body: string;
  href: string;
};

const MAX_BODY = 200;

export async function notifyMentions(
  supabase: AnyClient,
  input: MentionNotifyInput,
): Promise<number> {
  const targets = Array.from(new Set(input.mentions.filter(Boolean))).filter(
    (id) => id !== input.authorId,
  );
  if (targets.length === 0) return 0;

  // Só notifica quem é membro do workspace (revalidação server-side do escopo).
  const query = supabase.from("brand_members") as {
    select: (cols: string) => {
      eq: (
        c: string,
        v: string,
      ) => {
        in: (
          c: string,
          v: string[],
        ) => Promise<{ data: Array<{ user_id: string }> | null; error: unknown }>;
      };
    };
  };
  const { data: members, error } = await query
    .select("user_id")
    .eq("brand_id", input.brandId)
    .in("user_id", targets);
  if (error) throw error;
  const allowed = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (allowed.length === 0) return 0;

  const snippet =
    input.body.length > MAX_BODY ? `${input.body.slice(0, MAX_BODY - 1)}…` : input.body;

  return insertNotificationsDeduped(
    supabase as never,
    allowed.map((userId: string) => ({
      user_id: userId,
      brand_id: input.brandId,
      kind: "mention",
      title: input.title,
      body: snippet,
      href: input.href,
      payload: { comment_id: input.commentId, author_id: input.authorId },
      dedupe_key: notificationDedupeKey("mention", input.commentId, userId),
    })),
  );
}

/** Envolve `notifyMentions` para nunca propagar erro ao chamador. */
export async function notifyMentionsSafe(
  supabase: AnyClient,
  input: MentionNotifyInput,
): Promise<void> {
  try {
    await notifyMentions(supabase, input);
  } catch (e) {
    console.error("[mentions] falha ao notificar menções", (e as Error)?.message);
  }
}

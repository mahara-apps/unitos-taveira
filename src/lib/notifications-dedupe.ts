/**
 * Idempotência de notificações.
 *
 * O banco tem um índice único parcial:
 *   ux_notifications_unread_dedupe (user_id, kind, dedupe_key) WHERE read_at IS NULL
 *
 * Ou seja: enquanto uma notificação do mesmo evento estiver PENDENTE (não lida),
 * nenhuma duplicata pode ser criada — mesmo com workers concorrentes, reloads
 * ou reprocessamentos.
 */

export type NotificationInsert = {
  user_id: string;
  brand_id: string | null;
  kind: string;
  title: string;
  body?: string | null;
  href?: string | null;
  payload?: Record<string, unknown> | null;
  dedupe_key: string;
};

/** Chave canônica de deduplicação por evento. */
export function notificationDedupeKey(kind: string, ...parts: Array<string | null | undefined>) {
  return [kind, ...parts.map((p) => p ?? "-")].join(":");
}

const UNIQUE_VIOLATION = "23505";

type MinimalClient = {
  from: (table: string) => {
    insert: (rows: unknown) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
};

/**
 * Insere notificações ignorando duplicatas pendentes (violação do índice único).
 * Retorna quantas foram realmente criadas.
 */
export async function insertNotificationsDeduped(
  client: MinimalClient,
  rows: NotificationInsert[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await client.from("notifications").insert(rows);
  if (!error) return rows.length;
  if (error.code !== UNIQUE_VIOLATION) throw error;

  // Batch caiu por causa de pelo menos uma duplicata: reinsere linha a linha.
  let inserted = 0;
  for (const row of rows) {
    const res = await client.from("notifications").insert([row]);
    if (!res.error) inserted++;
    else if (res.error.code !== UNIQUE_VIOLATION) throw res.error;
  }
  return inserted;
}

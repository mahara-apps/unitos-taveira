/**
 * Helpers server-only das notificações. Ficam fora do arquivo de server
 * functions porque o splitter remove irmãos de runtime desse módulo.
 */
export const NOTIFICATION_SELECT_COLUMNS =
  "id,brand_id,user_id,kind,title,body,href,payload,read_at,archived_at,created_at,dedupe_key";

type AnyClient = { from: (table: "notifications") => any };

/** Contador canônico do sino: pendentes = não lidas E não arquivadas, no escopo atual. */
export async function pendingNotificationsCount(
  supabase: AnyClient,
  userId: string,
  brandId: string | null,
): Promise<number> {
  let q = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null)
    .is("archived_at", null);
  if (brandId) q = q.eq("brand_id", brandId);
  const { count, error } = await q;
  if (error) throw error;
  return (count as number | null) ?? 0;
}

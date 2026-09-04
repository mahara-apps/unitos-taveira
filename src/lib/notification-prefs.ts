/**
 * Preferências de notificação — fonte única.
 *
 * Só existem preferências para eventos que TÊM emissor real. Cada chave abaixo
 * é aplicada no servidor (SQL: `public.notification_prefs_allows`) antes de
 * inserir a notificação, e replicada aqui para os emissores em TypeScript.
 *
 * Kinds críticos (`sla_overdue`, `sla_overdue_manager`, `briefing_submitted`)
 * NÃO são preferíveis: nenhuma preferência de usuário pode bloqueá-los.
 */
export const NOTIFICATION_PREF_KEYS = [
  "comments",
  "assignments",
  "approvals",
  "deadlines",
  "ai_jobs",
] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];
export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  comments: true,
  assignments: true,
  approvals: true,
  deadlines: true,
  ai_jobs: true,
};

/** Mapa kind → preferência. `null` = crítico (sempre entregue). */
const PREF_BY_KIND: Record<string, NotificationPrefKey | null> = {
  mention: "comments",
  assignment: "assignments",
  approval_requested: "approvals",
  approval_decision: "approvals",
  deadline: "deadlines",
  system: "ai_jobs",
  sla_overdue: null,
  sla_overdue_manager: null,
  briefing_submitted: null,
};

export function prefKeyForKind(kind: string): NotificationPrefKey | null {
  return PREF_BY_KIND[kind] ?? null;
}

export function normalizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const key of NOTIFICATION_PREF_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
  }
  return out;
}

/** Decide localmente se um kind é permitido pelas prefs de um usuário. */
export function allowsKind(prefs: unknown, kind: string): boolean {
  const key = prefKeyForKind(kind);
  if (!key) return true; // crítico
  return normalizeNotificationPrefs(prefs)[key];
}

type PrefsClient = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (
        col: string,
        vals: string[],
      ) => Promise<{ data: Array<{ id: string; notification_prefs: unknown }> | null }>;
    };
  };
};

/**
 * Filtra linhas de notificação pelas preferências dos destinatários.
 * Kinds críticos passam sempre. Ausência de perfil = default (permitido).
 */
export async function filterRowsByPrefs<T extends { user_id: string; kind: string }>(
  client: PrefsClient,
  rows: T[],
): Promise<T[]> {
  const needing = rows.filter((r) => prefKeyForKind(r.kind) !== null);
  if (needing.length === 0) return rows;

  const ids = Array.from(new Set(needing.map((r) => r.user_id)));
  const { data } = await client
    .from("user_profiles")
    .select("id, notification_prefs")
    .in("id", ids);
  const byUser = new Map<string, unknown>((data ?? []).map((r) => [r.id, r.notification_prefs]));

  return rows.filter((r) => allowsKind(byUser.get(r.user_id), r.kind));
}

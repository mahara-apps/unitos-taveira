/**
 * Janela de exibição das notificações.
 *
 * O popup NÃO é um histórico infinito: mostra apenas notificações recentes.
 * Notificações antigas continuam no banco (histórico), mas não poluem o popup.
 */
export const NOTIFICATION_SCOPES = ["popup", "inbox"] as const;
export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];

export const NOTIFICATION_WINDOW: Record<NotificationScope, { days: number; limit: number }> = {
  popup: { days: 30, limit: 20 },
  inbox: { days: 90, limit: 200 },
};

export function notificationWindow(
  scope: NotificationScope,
  now: Date = new Date(),
): { sinceIso: string; limit: number; days: number } {
  const { days, limit } = NOTIFICATION_WINDOW[scope];
  return {
    sinceIso: new Date(now.getTime() - days * 86_400_000).toISOString(),
    limit,
    days,
  };
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useActiveContextOptional } from "@/hooks/use-active-context";
import {
  resolveNotificationTarget,
  type NotificationTargetLike,
} from "@/lib/notification-target";

/**
 * Clique no aviso: troca o cliente ativo quando o item pertence a outro
 * cliente e navega para a tela do item já aberto.
 */
export function NotificationLink({
  notification,
  onNavigate,
  className,
  children,
}: {
  notification: NotificationTargetLike;
  onNavigate?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { clientId, setClientId } = useActiveContextOptional();
  const target = resolveNotificationTarget(notification);

  return (
    <Link
      to={target.to as never}
      params={(target.params ?? {}) as never}
      search={(target.search ?? {}) as never}
      className={className}
      onClick={() => {
        if (target.clientId && target.clientId !== clientId) setClientId(target.clientId);
        onNavigate?.();
      }}
    >
      {children}
    </Link>
  );
}

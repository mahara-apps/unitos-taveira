import {
  AlertCircle,
  CheckCircle2,
  Clock,
  MessageSquare,
  MessagesSquare,

  Sparkles,
  UserPlus,
  AlarmClock,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

export type NotificationKind = Database["public"]["Enums"]["notification_kind"];

export const KIND_META: Record<
  NotificationKind,
  {
    label: string;
    icon: LucideIcon;
    color: string;
    tone: "violet" | "sky" | "amber" | "emerald" | "rose" | "neutral";
  }
> = {
  mention: { label: "Menção", icon: MessageSquare, color: "text-sky-500", tone: "sky" },
  assignment: { label: "Atribuição", icon: UserPlus, color: "text-violet-500", tone: "violet" },
  approval_requested: {
    label: "Aprovação pendente",
    icon: AlertCircle,
    color: "text-amber-500",
    tone: "amber",
  },
  approval_decision: {
    label: "Decisão",
    icon: CheckCircle2,
    color: "text-emerald-500",
    tone: "emerald",
  },
  deadline: { label: "Prazo", icon: Clock, color: "text-rose-500", tone: "rose" },
  message: { label: "Mensagem", icon: MessagesSquare, color: "text-sky-500", tone: "sky" },

  system: { label: "Sistema", icon: Sparkles, color: "text-indigo-500", tone: "neutral" },
  sla_overdue: { label: "SLA vencido", icon: AlarmClock, color: "text-rose-500", tone: "rose" },
  sla_overdue_manager: {
    label: "SLA vencido (equipe)",
    icon: ShieldAlert,
    color: "text-rose-500",
    tone: "rose",
  },
};

export function iconFor(kind: NotificationKind): LucideIcon {
  return (KIND_META[kind] ?? KIND_META.system).icon;
}

export function colorFor(kind: NotificationKind): string {
  return (KIND_META[kind] ?? KIND_META.system).color;
}

export function labelFor(kind: NotificationKind): string {
  return (KIND_META[kind] ?? KIND_META.system).label;
}

/** pt-BR relative time — "agora", "há 3 min", "há 2 h", "ontem", "há 4 d", or a date. */
export function relativeTimePtBr(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 30) return "agora";
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export type NotificationBucket = "today" | "yesterday" | "week" | "older";

export function bucketFor(iso: string): NotificationBucket {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const startWeek = startToday - 6 * 86_400_000;
  const t = d.getTime();
  if (t >= startToday) return "today";
  if (t >= startYesterday) return "yesterday";
  if (t >= startWeek) return "week";
  return "older";
}

export const BUCKET_LABEL: Record<NotificationBucket, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  week: "Esta semana",
  older: "Anteriores",
};

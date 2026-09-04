import type { PublicationOverall } from "@/lib/calendar-board.functions";
import type { SocialNetworkKey } from "@/lib/calendar-tokens";

/**
 * Linguagem visual única de status de publicação (agenda, lista, painel,
 * detalhe). Usa tokens semânticos do design system — sem cores hardcoded de
 * marca — e reflete apenas estados REAIS do pipeline.
 */
export type StatusToken = {
  label: string;
  /** classes para badge/chip */
  chip: string;
  dot: string;
  /** cor de texto do rótulo de status */
  text: string;
  /** borda lateral do card na agenda */
  accent: string;
};

export const PUBLICATION_STATUS: Record<PublicationOverall, StatusToken> = {
  draft: {
    label: "Rascunho",
    chip: "border-border/70 bg-muted/60 text-muted-foreground",
    dot: "bg-muted-foreground/60",
    text: "text-muted-foreground",
    accent: "border-l-muted-foreground/40",
  },
  awaiting_approval: {
    label: "Aguardando aprovação",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-300",
    accent: "border-l-amber-500",
  },
  ready: {
    label: "Aprovado · sem agenda",
    chip: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-300",
    accent: "border-l-violet-500",
  },
  scheduled: {
    label: "Agendado",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-300",
    accent: "border-l-blue-500",
  },
  publishing: {
    label: "Publicando",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-300",
    accent: "border-l-sky-500",
  },
  published: {
    label: "Publicado",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-300",
    accent: "border-l-emerald-500",
  },
  partial: {
    label: "Parcial",
    chip: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
    text: "text-orange-600 dark:text-orange-300",
    accent: "border-l-orange-500",
  },
  failed: {
    label: "Falhou",
    chip: "border-destructive/40 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
    text: "text-destructive",
    accent: "border-l-destructive",
  },
  cancelled: {
    label: "Cancelado",
    chip: "border-border/70 bg-muted/50 text-muted-foreground",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    accent: "border-l-border",
  },
  proposed: {
    label: "Agenda sugerida",
    chip: "border-dashed border-primary/40 bg-primary/5 text-primary",
    dot: "bg-primary/50",
    text: "text-primary",
    accent: "border-l-primary/50",
  },
  reserved: {
    label: "Data reservada",
    chip: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    dot: "bg-teal-500",
    text: "text-teal-600 dark:text-teal-300",
    accent: "border-l-teal-500",
  },
};

export const DESTINATION_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  awaiting_retry: "Aguardando nova tentativa",
  cancelled: "Cancelado",
};

export const FORMAT_LABEL: Record<string, string> = {
  feed: "Feed",
  stories: "Stories",
  reels: "Reels",
  carrossel: "Carrossel",
  carousel: "Carrossel",
};

export function formatLabel(raw: string | null | undefined) {
  const k = (raw ?? "").toLowerCase();
  return FORMAT_LABEL[k] ?? (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "—");
}

export function timeLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dayLabel(iso: string | null | undefined) {
  if (!iso) return "Sem data";
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (same(d, today)) return "Hoje";
  if (same(d, tomorrow)) return "Amanhã";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function relativeLabel(iso: string | null | undefined) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(Math.abs(diff) / 60000);
  const suffix = diff >= 0 ? "há" : "em";
  if (mins < 1) return "agora";
  if (mins < 60) return `${suffix} ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${suffix} ${hours} h`;
  const days = Math.round(hours / 24);
  return `${suffix} ${days} d`;
}

/** Cor de marca (tint) por rede — usada nos ícones de destino. */
export const NETWORK_COLOR: Record<SocialNetworkKey, string> = {
  instagram: "text-pink-500 dark:text-pink-400",
  facebook: "text-blue-600 dark:text-blue-400",
  linkedin: "text-sky-600 dark:text-sky-400",
  tiktok: "text-rose-500 dark:text-rose-400",
  youtube: "text-red-600 dark:text-red-500",
  whatsapp: "text-emerald-600 dark:text-emerald-400",
  threads: "text-foreground/70",
  x: "text-foreground/70",
  blog: "text-amber-600 dark:text-amber-400",
  other: "text-muted-foreground",
};

/** Chip colorido por formato (Feed/Stories/Reels/Carrossel). */
export const FORMAT_CHIP: Record<string, string> = {
  feed: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  stories: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  reels: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  carrossel: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  carousel: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
};

export function formatChip(raw: string | null | undefined) {
  const k = (raw ?? "").toLowerCase();
  return FORMAT_CHIP[k] ?? "border-border/70 bg-muted/60 text-muted-foreground";
}

import type { StageColor } from "@/lib/content.functions";
import type { ContentFormat } from "@/lib/content-formats";

export const STAGE_BG: Record<StageColor, string> = {
  muted: "bg-muted-foreground/60",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
};

// Top-band gradient per stage (Kiiru-inspired, subtle)
export const STAGE_GRADIENT: Record<StageColor, string> = {
  muted: "from-zinc-400/70 via-zinc-400/40 to-transparent",
  indigo: "from-indigo-500 via-indigo-400/60 to-transparent",
  violet: "from-violet-500 via-violet-400/60 to-transparent",
  amber: "from-amber-500 via-amber-400/60 to-transparent",
  emerald: "from-emerald-500 via-emerald-400/60 to-transparent",
  sky: "from-sky-500 via-sky-400/60 to-transparent",
  rose: "from-rose-500 via-rose-400/60 to-transparent",
  cyan: "from-cyan-500 via-cyan-400/60 to-transparent",
};

// Prioridade — alinhada à paleta semântica do DESIGN_SYSTEM (sky/amber/rose).
export const PRIORITY_STYLES: Record<string, string> = {
  none: "border-border/60 bg-muted/40 text-muted-foreground",
  low: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  high: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  urgent: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

// Formato — paleta semântica do DS (sky/violet/amber/emerald).
export const FORMAT_STYLE =
  "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300";

export const FORMAT_STYLES: Record<ContentFormat, string> = {
  feed: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  reels: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  stories: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  carrossel: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
};

/**
 * Taxonomia de formatos: fonte única em `@/lib/content-formats`.
 * Aqui ficam APENAS estilos de exibição, indexados pelas chaves canônicas.
 * `normalizeFormat`/`FormatKey`/`FORMATS` (rótulos capitalizados) foram
 * removidos — use `normalizeContentFormat`, `ContentFormat`, `CONTENT_FORMATS`
 * e `CONTENT_FORMAT_LABEL`.
 */

export const PRIORITY_LABEL: Record<string, string> = {
  none: "Sem prioridade",
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

import {
  Instagram,
  Music2,
  Youtube,
  Linkedin,
  Twitter,
  Facebook,
  AtSign,
  FileText,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";

export const CHANNELS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "instagram", label: "Instagram", icon: Instagram },
  { id: "tiktok", label: "TikTok", icon: Music2 },
  { id: "youtube", label: "YouTube", icon: Youtube },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin },
  { id: "x", label: "Twitter/X", icon: Twitter },
  { id: "facebook", label: "Facebook", icon: Facebook },
  { id: "threads", label: "Threads", icon: AtSign },
  { id: "blog", label: "Blog", icon: FileText },
  { id: "graphic", label: "Material Gráfico", icon: ImageIcon },
];

// Per-channel badge styles (border + bg + text). Instagram uses gradient bg.
export const CHANNEL_STYLES: Record<string, string> = {
  instagram:
    "border-transparent bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#515BD4] text-white",
  tiktok:
    "border-zinc-900/30 bg-zinc-900/10 text-zinc-900 dark:border-zinc-100/20 dark:bg-zinc-100/10 dark:text-zinc-100",
  youtube: "border-red-600/30 bg-red-600/10 text-red-600 dark:text-red-400",
  linkedin: "border-[#0A66C2]/30 bg-[#0A66C2]/10 text-[#0A66C2] dark:text-sky-300",
  x: "border-zinc-900/30 bg-zinc-900/10 text-zinc-900 dark:border-zinc-100/20 dark:bg-zinc-100/10 dark:text-zinc-100",
  facebook: "border-[#1877F2]/30 bg-[#1877F2]/10 text-[#1877F2] dark:text-blue-300",
  threads:
    "border-zinc-900/30 bg-zinc-900/10 text-zinc-900 dark:border-zinc-100/20 dark:bg-zinc-100/10 dark:text-zinc-100",
  blog: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  graphic: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
};

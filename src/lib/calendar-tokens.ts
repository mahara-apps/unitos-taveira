import {
  Instagram,
  Facebook,
  Linkedin,
  Youtube,
  MessageCircle,
  AtSign,
  Music2,
  Globe,
  type LucideIcon,
} from "lucide-react";

export type EventTypeKey = "post" | "appointment" | "seasonal";

export const EVENT_TYPE_STYLES: Record<EventTypeKey, { chip: string; dot: string; label: string }> =
  {
    post: {
      chip: "border-border/70 bg-muted/60 text-foreground/90 dark:bg-muted/40",
      dot: "bg-foreground/60",
      label: "Publicação",
    },
    appointment: {
      chip: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
      dot: "bg-blue-500",
      label: "Compromisso",
    },
    seasonal: {
      chip: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
      dot: "bg-orange-500",
      label: "Data sazonal",
    },
  };

export type SocialNetworkKey =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "whatsapp"
  | "threads"
  | "x"
  | "blog"
  | "other";

export const SOCIAL_NETWORKS: Record<
  SocialNetworkKey,
  { label: string; Icon: LucideIcon; hoverColor: string }
> = {
  instagram: { label: "Instagram", Icon: Instagram, hoverColor: "hover:text-pink-500" },
  facebook: { label: "Facebook", Icon: Facebook, hoverColor: "hover:text-blue-600" },
  linkedin: { label: "LinkedIn", Icon: Linkedin, hoverColor: "hover:text-sky-600" },
  tiktok: { label: "TikTok", Icon: Music2, hoverColor: "hover:text-rose-500" },
  youtube: { label: "YouTube", Icon: Youtube, hoverColor: "hover:text-red-600" },
  whatsapp: { label: "WhatsApp", Icon: MessageCircle, hoverColor: "hover:text-emerald-500" },
  threads: { label: "Threads", Icon: AtSign, hoverColor: "hover:text-foreground" },
  x: { label: "X", Icon: AtSign, hoverColor: "hover:text-foreground" },
  blog: { label: "Blog", Icon: Globe, hoverColor: "hover:text-amber-600" },
  other: { label: "Outros", Icon: Globe, hoverColor: "hover:text-foreground" },
};

export function classifySocialNetwork(raw: string | null | undefined): SocialNetworkKey {
  const k = (raw ?? "").toLowerCase().trim();
  if (!k) return "other";
  if (k.includes("insta") || k.includes("story") || k.includes("reel") || k.includes("feed"))
    return "instagram";
  if (k.includes("face")) return "facebook";
  if (k.includes("linked")) return "linkedin";
  if (k.includes("tiktok")) return "tiktok";
  if (k.includes("youtube") || k === "yt" || k.includes("short")) return "youtube";
  if (k.includes("whats")) return "whatsapp";
  if (k.includes("thread")) return "threads";
  if (k === "x" || k.includes("twitter")) return "x";
  if (k.includes("blog")) return "blog";
  return "other";
}

/** Extract unique network keys from an arbitrary list of channel strings. */
export function uniqueNetworks(channels: (string | null | undefined)[]): SocialNetworkKey[] {
  const seen = new Set<SocialNetworkKey>();
  channels.forEach((c) => seen.add(classifySocialNetwork(c)));
  return Array.from(seen);
}

import { CONTENT_FORMAT_LABEL, formatsForChannel } from "@/lib/content-formats";
import {
  AtSign,
  Facebook,
  Instagram,
  Linkedin,
  Music2,
  Radio,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Vocabulário visual único de canais sociais (ícone, rótulo, disponibilidade)
 * e indicador de status padronizado. Usado pela tela de Integrações, pelo
 * perfil do cliente e pelo editor de peça — sem estado paralelo: apenas
 * apresentação.
 */

export type ChannelKey =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "twitter"
  | "threads";

export type ChannelDef = {
  key: ChannelKey;
  label: string;
  icon: LucideIcon;
  tone: string;
  /** true = OAuth implementado (Meta). false = "Em breve". */
  available: boolean;
  provider?: "meta";
  /** Caminho recomendado de conexão (aparece primeiro e com selo). */
  recommended?: boolean;
  /** Explicação curta exibida no cartão de conexão. */
  hint?: string;
};

export const CHANNEL_DEFS: ChannelDef[] = [
  {
    key: "instagram",
    label: "Instagram",
    icon: Instagram,
    tone: "text-pink-500",
    available: true,
    provider: "meta",
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: Facebook,
    tone: "text-sky-600",
    available: true,
    provider: "meta",
    recommended: true,
    hint: "Traz as Páginas e as contas de Instagram vinculadas — atribuição correta dos ativos",
  },
  { key: "tiktok", label: "TikTok", icon: Music2, tone: "text-muted-foreground", available: false },
  {
    key: "linkedin",
    label: "LinkedIn",
    icon: Linkedin,
    tone: "text-muted-foreground",
    available: false,
  },
  {
    key: "youtube",
    label: "YouTube",
    icon: Youtube,
    tone: "text-muted-foreground",
    available: false,
  },
  {
    key: "threads",
    label: "Threads",
    icon: AtSign,
    tone: "text-muted-foreground",
    available: false,
  },
  {
    key: "twitter",
    label: "X / Twitter",
    icon: Twitter,
    tone: "text-muted-foreground",
    available: false,
  },
];

/**
 * Tamanho ÚNICO do ícone de canal em listas/cards (harmonia visual).
 * Não usar tamanhos ad-hoc por tela.
 */
export const CHANNEL_ICON_SIZE = "h-4 w-4";

export const CHANNEL_BY_KEY = new Map(CHANNEL_DEFS.map((c) => [c.key, c]));
/** Canais conectáveis — recomendado primeiro (Facebook), demais na ordem do catálogo. */
export const CONNECTABLE_CHANNELS = CHANNEL_DEFS.filter((c) => c.available).sort(
  (a, b) => Number(!!b.recommended) - Number(!!a.recommended),
);
export const UPCOMING_CHANNELS = CHANNEL_DEFS.filter((c) => !c.available);

export function channelDef(channel: string): ChannelDef {
  return (
    CHANNEL_BY_KEY.get(channel as ChannelKey) ?? {
      key: "instagram",
      label: channel,
      icon: Radio,
      tone: "text-muted-foreground",
      available: false,
    }
  );
}

/** Formatos suportados por canal (apresentação; a validação real é no wizard). */
export const CHANNEL_FORMATS: Record<string, string[]> = {
  instagram: formatsForChannel("instagram").map((f) => CONTENT_FORMAT_LABEL[f]),
  facebook: formatsForChannel("facebook").map((f) => CONTENT_FORMAT_LABEL[f]),
};

export type StatusKey = "active" | "attention" | "disconnected" | "soon";

const STATUS_LABEL: Record<StatusKey, string> = {
  active: "Conectado",
  attention: "Atenção",
  disconnected: "Desconectado",
  soon: "Em breve",
};

const STATUS_DOT: Record<StatusKey, string> = {
  active: "bg-emerald-500",
  attention: "bg-amber-500",
  disconnected: "bg-muted-foreground/50",
  soon: "bg-muted-foreground/40",
};

export function normalizeStatus(status: string | null | undefined): StatusKey {
  if (status === "active") return "active";
  if (status === "attention" || status === "expired") return "attention";
  return "disconnected";
}

export function StatusDot({
  status,
  label,
  className,
}: {
  status: StatusKey;
  /** Sobrescreve o rótulo (ex.: "Ativo" no perfil do cliente). */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "nunca sincronizado";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d <= 30 ? `há ${d} d` : new Date(iso).toLocaleDateString("pt-BR");
}

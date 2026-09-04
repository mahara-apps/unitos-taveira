import { APP_TIMEZONE, zonedTimeToUtc } from "@/lib/timezone";

/**
 * Fonte ÚNICA de exibição de agenda de uma peça.
 *
 * A agenda de conteúdo tem duas colunas com papéis distintos:
 * - `proposed_at`: data proposta/reservada pela pauta (não publica nada);
 * - `scheduled_at`: agendamento efetivo de publicação.
 *
 * Calendário, board de Conteúdo, lista e modal derivam data + estado daqui,
 * para que a mesma peça nunca apareça "sem data" em uma tela e datada em outra.
 * Todos os rótulos são pt-BR no fuso oficial (America/Sao_Paulo).
 */
export type ScheduleState =
  | "none"
  | "proposed"
  | "internal_approved"
  | "client_pending"
  | "client_changes"
  | "reserved"
  | "scheduled"
  | "published";

export type ScheduleDisplayInput = {
  scheduled_at?: string | null;
  proposed_at?: string | null;
  published_at?: string | null;
  schedule_status?: string | null;
  schedule_approved_at?: string | null;
  schedule_client_comment?: string | null;
};

export type ScheduleDisplay = {
  /** Data efetiva a exibir/ordenar: publicação > agendamento > proposta. */
  iso: string | null;
  timestamp: number | null;
  state: ScheduleState;
  label: string;
  /** Texto curto do estado (selo). */
  stateLabel: string;
  chip: string;
  /** Data efetiva vem da proposta da pauta (não é agendamento de publicação). */
  isProposal: boolean;
  clientComment: string | null;
  approvedAtIso: string | null;
};

const STATE_TOKEN: Record<ScheduleState, { label: string; chip: string }> = {
  none: {
    label: "Sem data",
    chip: "border-border/70 bg-muted/60 text-muted-foreground",
  },
  proposed: {
    label: "Agenda sugerida",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  internal_approved: {
    label: "Aprovada internamente",
    chip: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  client_pending: {
    label: "Aguardando cliente",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  client_changes: {
    label: "Cliente pediu alteração",
    chip: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  reserved: {
    label: "Data reservada",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  scheduled: {
    label: "Publicação agendada",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  published: {
    label: "Publicado",
    chip: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
};

const SCHEDULE_STATES = new Set<ScheduleState>([
  "none",
  "proposed",
  "internal_approved",
  "client_pending",
  "client_changes",
  "reserved",
  "scheduled",
  "published",
]);

function normalizeStatus(raw: string | null | undefined): ScheduleState {
  const k = (raw ?? "").trim();
  return SCHEDULE_STATES.has(k as ScheduleState) ? (k as ScheduleState) : "none";
}

/** dd/MM · HH:mm no fuso oficial. */
export function scheduleDateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "Sem data";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sem data";
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${day} · ${time}`;
}

/** dd/MM/yyyy HH:mm no fuso oficial (tooltips e detalhe). */
export function scheduleFullLabel(iso: string | null | undefined): string {
  if (!iso) return "Sem data";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** `yyyy-MM-ddTHH:mm` no fuso oficial — valor de `<input type=datetime-local>`. */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

export function scheduleDisplay(post: ScheduleDisplayInput): ScheduleDisplay {
  const publishedAt = post.published_at ?? null;
  const scheduledAt = post.scheduled_at ?? null;
  const proposedAt = post.proposed_at ?? null;
  const raw = normalizeStatus(post.schedule_status);

  const iso = publishedAt ?? scheduledAt ?? proposedAt;
  const state: ScheduleState = publishedAt
    ? "published"
    : scheduledAt
      ? "scheduled"
      : proposedAt
        ? raw === "none"
          ? "proposed"
          : raw
        : "none";

  const token = STATE_TOKEN[state];
  const d = iso ? new Date(iso) : null;
  const valid = d && !Number.isNaN(d.getTime());

  return {
    iso: valid ? iso : null,
    timestamp: valid ? d!.getTime() : null,
    state,
    stateLabel: token.label,
    chip: token.chip,
    label: valid ? scheduleDateTimeLabel(iso) : token.label,
    isProposal: !publishedAt && !scheduledAt && !!proposedAt,
    clientComment: post.schedule_client_comment ?? null,
    approvedAtIso: post.schedule_approved_at ?? null,
  };
}

/** A peça tem agenda controlada pela pauta (proposta/reserva). */
export function hasProposalTrack(post: ScheduleDisplayInput): boolean {
  return !!post.proposed_at || normalizeStatus(post.schedule_status) !== "none";
}

/**
 * Converte o valor de `<input type=datetime-local>` (hora de parede em
 * Brasília) para o instante UTC persistido. Contraparte de `toLocalInputValue`.
 */
export function fromLocalInputValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = zonedTimeToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

import { useState, type ReactNode } from "react";
import { Image as ImageIcon } from "lucide-react";

/**
 * Primitivas visuais do Portal do Cliente (apenas apresentação).
 *
 * Regras: linguagem de cliente, alvos de toque grandes, cores de status vindas
 * dos tokens `--portal-*` e NUNCA um ícone de imagem quebrada — sem arte, o
 * espaço recebe um placeholder neutro.
 */

export type PortalStatus = "waiting" | "scheduled" | "published" | "adjust" | "neutral";

const STATUS_CLASS: Record<PortalStatus, string> = {
  waiting: "bg-portal-waiting-soft text-portal-waiting-ink",
  scheduled: "bg-portal-scheduled-soft text-portal-scheduled",
  published: "bg-portal-published-soft text-portal-published",
  adjust: "bg-portal-adjust-soft text-portal-adjust",
  neutral: "bg-muted text-muted-foreground",
};

const STATUS_DOT: Record<PortalStatus, string> = {
  waiting: "bg-portal-waiting",
  scheduled: "bg-portal-scheduled",
  published: "bg-portal-published",
  adjust: "bg-portal-adjust",
  neutral: "bg-muted-foreground",
};

/** Selo de status compacto. */
export function PortalStatusPill({
  status,
  children,
  dot = false,
  className = "",
}: {
  status: PortalStatus;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold ${STATUS_CLASS[status]} ${className}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} /> : null}
      {children}
    </span>
  );
}

/**
 * Miniatura da arte. Sem `url`, mostra um placeholder neutro; se a imagem
 * falhar ao carregar, cai no mesmo placeholder em vez de quebrar.
 */
export function PortalThumb({
  url,
  alt,
  size = "sm",
}: {
  url?: string | null;
  alt?: string;
  size?: "sm" | "md";
}) {
  const [broken, setBroken] = useState(false);
  const box = size === "md" ? "h-[60px] w-[60px] rounded-xl" : "h-11 w-11 rounded-[11px]";
  const showImg = Boolean(url) && !broken;
  return (
    <div className={`${box} shrink-0 overflow-hidden border border-border/70 bg-muted`}>
      {showImg ? (
        <img
          src={url as string}
          alt={alt ?? ""}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-muted-foreground/50">
          <ImageIcon className="h-5 w-5" strokeWidth={1.6} />
        </div>
      )}
    </div>
  );
}

/** Placeholder grande (prévia sem arte). */
export function PortalMediaPlaceholder({ label = "Arte da publicação" }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground/70">
      <ImageIcon className="h-8 w-8" strokeWidth={1.4} />
      <span className="text-xs font-semibold">{label}</span>
    </div>
  );
}

/** Cabeçalho de seção com link opcional. */
export function PortalSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2.5 flex items-center gap-3 px-0.5">
        <h2 className="text-[15px] font-extrabold tracking-tight">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

/** Linha compacta: miniatura + título + meta + selo. */
export function PortalRow({
  thumbUrl,
  title,
  meta,
  status,
  statusLabel,
  onClick,
  trailing,
}: {
  thumbUrl?: string | null;
  title: string;
  meta?: ReactNode;
  status?: PortalStatus;
  statusLabel?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const inner = (
    <>
      <PortalThumb url={thumbUrl} alt={title} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-bold">{title}</div>
        {meta ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] font-semibold text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      {status && statusLabel ? (
        <PortalStatusPill status={status}>{statusLabel}</PortalStatusPill>
      ) : null}
      {trailing}
    </>
  );
  if (!onClick)
    return (
      <div className="flex min-h-[68px] items-center gap-3 rounded-2xl border border-border bg-card p-3">
        {inner}
      </div>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/50"
    >
      {inner}
    </button>
  );
}

/** Marca visual do Instagram (só identidade de canal, sem termos internos). */
export function ChannelDot() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-[4px]"
      style={{ background: "linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7)" }}
    />
  );
}

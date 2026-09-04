// Primitivas visuais do Perfil do Cliente (abas Cadastro e Gestão da conta).
// Extraídas da linguagem já usada em "Visão geral" e "Pauta": superfície
// rounded-2xl, border-border/50, bg-card, header px-5 pt-4 e corpo px-5 py-4.
// Uso restrito ao Perfil do Cliente — não substituem componentes globais.
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageKpi, type KpiStatus } from "@/components/ui/page-kpi";
import { cn } from "@/lib/utils";

export function ProfilePageHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
          {badge}
        </div>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function ProfileSection({
  title,
  subtitle,
  icon,
  action,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-card",
        className,
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight">{title}</h3>
            {subtitle ? (
              <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={cn("min-h-0 flex-1 px-5 py-4", bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="shrink-0 border-t border-border/40 px-5 py-3">{footer}</footer>
      ) : null}
    </section>
  );
}

export function ProfileFieldGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", className)}>{children}</div>;
}

export function ProfileField({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", full && "md:col-span-2")}>
      <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const STAT_TONE = {
  default: "neutral",
  emerald: "success",
  amber: "warning",
  sky: "info",
  violet: "info",
  destructive: "danger",
} as const satisfies Record<string, KpiStatus>;

/**
 * ProfileStat — mantém a API histórica das abas do perfil do cliente e delega
 * a apresentação ao padrão único `PageKpi`.
 */
export function ProfileStat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof STAT_TONE;
}) {
  return <PageKpi label={label} value={value} description={hint} status={STAT_TONE[tone]} />;
}

export function ProfileEmpty({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="grid h-9 w-9 place-items-center rounded-full border border-border/50 text-muted-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      {hint ? <p className="max-w-[26rem] text-[11px] text-muted-foreground">{hint}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/** Barra de ações de salvamento: sempre visível quando há alterações. */
export function ProfileSaveBar({
  dirty,
  saving,
  saved,
  onSave,
  onDiscard,
  disabled,
  hint,
}: {
  dirty: boolean;
  saving: boolean;
  saved?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  const status = saving
    ? { text: "Salvando alterações…", tone: "text-sky-500" }
    : dirty
      ? { text: "Alterações não salvas", tone: "text-amber-500" }
      : saved
        ? { text: "Alterações salvas", tone: "text-emerald-500" }
        : { text: hint ?? "Tudo em ordem", tone: "text-muted-foreground" };

  return (
    <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-border/50 bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            saving
              ? "bg-sky-500"
              : dirty
                ? "bg-amber-500"
                : saved
                  ? "bg-emerald-500"
                  : "bg-muted-foreground/40",
          )}
        />
        <span className={cn("truncate text-[12px] font-medium", status.tone)}>{status.text}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onDiscard ? (
          <button
            type="button"
            onClick={onDiscard}
            disabled={!dirty || saving || disabled}
            className="rounded-md px-3 py-2 text-[12px] font-medium text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            Descartar
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || disabled || !dirty}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? "Salvando…" : "Salvar alterações"}
        </button>
      </div>
    </div>
  );
}

/** Skeleton no mesmo grid das seções — evita a sensação de tela antiga. */
export function ProfileSectionsSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-3 w-80" />
      </div>
      {Array.from({ length: sections }).map((_, i) => (
        <Skeleton key={i} className="h-52 w-full rounded-2xl" />
      ))}
    </div>
  );
}

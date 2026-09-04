// Primitivas visuais compartilhadas APENAS pela aba "Visão geral" do cliente.
// Não usar em outras telas — a linguagem aqui é intencionalmente enxuta para o
// grid 50/50 do centro de comando.
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function OverviewCard({
  title,
  subtitle,
  icon,
  action,
  footer,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex h-full min-h-[16rem] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card",
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
        {action}
      </header>
      <div className="min-h-0 flex-1 px-5 py-4">{children}</div>
      {footer ? (
        <footer className="shrink-0 border-t border-border/40 px-5 py-2.5">{footer}</footer>
      ) : null}
    </section>
  );
}

export function OverviewLink({
  label,
  onClick,
  href,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const cls =
    "inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground";
  if (href) {
    return (
      <a href={href} className={cls}>
        {label}
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

export function OverviewEmpty({
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
    <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
      <div className="grid h-9 w-9 place-items-center rounded-full border border-border/50 text-muted-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      {hint ? <p className="max-w-[24rem] text-[11px] text-muted-foreground">{hint}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

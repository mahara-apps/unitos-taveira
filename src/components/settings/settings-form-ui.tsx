// Primitivas visuais das telas de Configurações → Minha conta.
// Linguagem: superfícies discretas, separadores sutis, zero cards aninhados,
// ritmo vertical generoso e accent lime da marca usado com parcimônia.
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Bloco de configuração: título/descrição à esquerda, campos à direita no desktop. */
export function SettingsBlock({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "grid gap-6 border-t border-border/50 py-10 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-16",
        className,
      )}
    >
      <div className="min-w-0 lg:pt-0.5">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 lg:max-w-2xl">{children}</div>
    </section>
  );
}

export function SettingsFieldGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2", className)}>
      {children}
    </div>
  );
}

export function SettingsField({
  label,
  htmlFor,
  hint,
  full,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-2", full && "sm:col-span-2")}>
      <Label htmlFor={htmlFor} className="text-[12.5px] font-medium text-foreground/80">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Linha de configuração com ação à direita — substitui cards de atalho. */
export function SettingsRow({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-4 rounded-xl bg-muted/40 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span> : null}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{title}</p>
          {description ? (
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0 sm:justify-self-end">{action}</div> : null}
    </div>
  );
}

/** Metadados da conta (função, fuso, idioma, WhatsApp…) em grupos respirados. */
export function SettingsMetaList({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
  );
}

export function SettingsMetaItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon ? <span className="shrink-0 text-brand-lime-foreground/70">{icon}</span> : null}
        {label}
      </dt>
      <dd className="mt-1 min-w-0 truncate text-[13.5px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

/** Segmented control do produto (Pessoal / Segurança). */
export const settingsSegmentedListClass =
  "inline-flex h-11 items-center gap-1 rounded-xl bg-muted/60 p-1";

export const settingsSegmentedTriggerClass =
  "rounded-lg px-5 text-[13px] font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm";

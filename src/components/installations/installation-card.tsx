import { ArrowRight, Globe, ShieldCheck } from "lucide-react";

import {
  INSTALLATION_HEALTH_LABEL,
  type InstallationHealth,
} from "@/lib/installation/manager-contract";
import type { InstallationRecord } from "@/lib/installation/manager.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTimeBr } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  LifecycleTrail,
  StateBadge,
  StatusBadge,
  VersionPair,
  lifecycleIndex,
  type VisualState,
} from "./installation-visuals";

const HEALTH_STATE: Record<InstallationHealth, VisualState> = {
  unknown: "pending",
  healthy: "ok",
  degraded: "attention",
  failing: "error",
};

export function InstallationCard({
  installation,
  onOpen,
}: {
  installation: InstallationRecord;
  onOpen: () => void;
}) {
  const i = installation;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "cursor-pointer transition hover:border-primary/40 hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <CardContent className="space-y-3 p-4">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{i.name}</h3>
              {/* "Atualizada"/"Atualização disponível" já é dito pelo bloco de
                  versão abaixo — aqui só entram estados que ele não cobre. */}
              {i.status !== "up_to_date" && i.status !== "update_available" && (
                <StatusBadge status={i.status} />
              )}
              <StateBadge
                state={HEALTH_STATE[i.health]}
                label={INSTALLATION_HEALTH_LABEL[i.health]}
              />
            </div>
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{i.domain ?? "domínio não informado"}</span>
            </p>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" tabIndex={-1}>
            Abrir <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </header>

        <VersionPair installed={i.currentVersion} available={i.availableVersion} />

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
          <LifecycleTrail activeIndex={lifecycleIndex(i)} complete={i.status === "up_to_date"} />
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            {i.lastValidatedAt
              ? `validada em ${formatDateTimeBr(i.lastValidatedAt)}`
              : "nunca validada"}
          </span>
        </footer>
      </CardContent>
    </Card>
  );
}

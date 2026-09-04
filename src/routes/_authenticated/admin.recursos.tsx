import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Lock, Search } from "lucide-react";

import { useActiveContext } from "@/hooks/use-active-context";
import { listBrandFeaturesForAdmin, setBrandFeature } from "@/lib/feature-flags.functions";
import { clearAccessCaches } from "@/lib/access-cache";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/recursos")({
  component: AdminFeaturesPage,
});

type Feature = Awaited<ReturnType<typeof listBrandFeaturesForAdmin>>[number];

function AdminFeaturesPage() {
  const { brandId } = useActiveContext();
  const listFn = useServerFn(listBrandFeaturesForAdmin);
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [pendingOff, setPendingOff] = React.useState<Feature | null>(null);

  const q = useQuery({
    queryKey: ["brand-features", brandId, "admin"],
    queryFn: () => listFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const features = q.data ?? [];
  const categories = Array.from(new Set(features.map((f) => f.category ?? "Outros")));
  const term = search.trim().toLowerCase();
  const filtered = features.filter((f) => {
    const matchCat = category === "all" || (f.category ?? "Outros") === category;
    const matchTerm =
      !term ||
      f.name.toLowerCase().includes(term) ||
      f.key.toLowerCase().includes(term) ||
      (f.description ?? "").toLowerCase().includes(term);
    return matchCat && matchTerm;
  });

  const grouped = new Map<string, Feature[]>();
  for (const f of filtered) {
    const cat = f.category ?? "Outros";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(f);
  }

  const active = features.filter((f) => f.enabled).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Recursos do cliente</h2>
        <p className="text-sm text-muted-foreground">
          Ative ou desative funcionalidades disponíveis para este ambiente.
        </p>
      </div>

      <PageKpiGrid>
        <PageKpi label="Recursos ativos" value={`${active}`} description={`de ${features.length}`} />
        <PageKpi label="Categorias" value={`${categories.length}`} />
        <PageKpi
          label="Obrigatórios"
          value={`${features.filter((f) => f.is_core).length}`}
          description="sempre ligados"
        />
        <PageKpi
          label="Desativados"
          value={`${features.filter((f) => !f.enabled).length}`}
          description="invisíveis para usuários"
        />
      </PageKpiGrid>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar recurso ou identificador…"
            className="pl-9"
            aria-label="Buscar recurso"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={category === "all" ? "secondary" : "ghost"}
            onClick={() => setCategory("all")}
          >
            Todas
          </Button>
          {categories.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={category === c ? "secondary" : "ghost"}
              onClick={() => setCategory(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Carregando recursos…
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhum recurso encontrado.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {Array.from(grouped.entries()).map(([cat, items]) => (
            <section key={cat} className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </h3>
              <div className="grid gap-2.5 lg:grid-cols-2">
                {items.map((f) => (
                  <FeatureRow
                    key={f.key}
                    brandId={brandId!}
                    feature={f}
                    onRequestDisable={() => setPendingOff(f)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <DisableDialog
        brandId={brandId!}
        feature={pendingOff}
        onClose={() => setPendingOff(null)}
      />
    </div>
  );
}

function useToggleFeature(brandId: string) {
  const qc = useQueryClient();
  const setFn = useServerFn(setBrandFeature);
  return useMutation({
    mutationFn: (vars: { featureKey: string; enabled: boolean }) =>
      setFn({ data: { brandId, featureKey: vars.featureKey, enabled: vars.enabled } }),
    onSuccess: async (_d, vars) => {
      toast.success(vars.enabled ? "Recurso ativado" : "Recurso desativado");
      clearAccessCaches();
      await qc.invalidateQueries({ queryKey: ["brand-features"] });
      await qc.invalidateQueries({ queryKey: ["admin-environment"] });
      await qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Falha ao alterar recurso"),
  });
}

function FeatureRow({
  brandId,
  feature,
  onRequestDisable,
}: {
  brandId: string;
  feature: Feature;
  onRequestDisable: () => void;
}) {
  const toggle = useToggleFeature(brandId);
  const locked = feature.is_core;

  return (
    <Card className={cn("border-border/60", !feature.enabled && "bg-muted/20")}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            {feature.name}
            {locked ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
          </CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {feature.description ?? "—"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Switch
            checked={feature.enabled}
            disabled={locked || toggle.isPending}
            aria-label={`${feature.enabled ? "Desativar" : "Ativar"} ${feature.name}`}
            onCheckedChange={(next) => {
              if (locked) return;
              if (!next) return onRequestDisable();
              toggle.mutate({ featureKey: feature.key, enabled: true });
            }}
          />
          <Badge
            variant={feature.enabled ? "default" : "outline"}
            className="text-[10px] uppercase tracking-wide"
          >
            {feature.enabled ? "Ativo" : "Inativo"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <code className="font-mono text-[11px] text-muted-foreground">feature: {feature.key}</code>
      </CardContent>
    </Card>
  );
}

function DisableDialog({
  brandId,
  feature,
  onClose,
}: {
  brandId: string;
  feature: Feature | null;
  onClose: () => void;
}) {
  const toggle = useToggleFeature(brandId);
  return (
    <AlertDialog open={!!feature} onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desativar {feature?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            O módulo deixa de aparecer no menu e o acesso direto pela URL será bloqueado para os
            usuários deste ambiente. Nenhum dado é apagado — você pode reativar depois. Super Admins
            continuam com acesso para testes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!feature) return;
              toggle.mutate({ featureKey: feature.key, enabled: false });
              onClose();
            }}
          >
            Desativar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

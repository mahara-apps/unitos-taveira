import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { useActiveContext } from "@/hooks/use-active-context";
import { getEnvironmentInfoFn, listAdminAuditFn } from "@/lib/admin-environment.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";

export const Route = createFileRoute("/_authenticated/admin/ambiente")({
  component: AdminEnvironmentPage,
});

const APP_VERSION = "1.0";

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return format(new Date(value), "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

function AdminEnvironmentPage() {
  const { brandId } = useActiveContext();
  const infoFn = useServerFn(getEnvironmentInfoFn);
  const auditFn = useServerFn(listAdminAuditFn);

  const infoQ = useQuery({
    queryKey: ["admin-environment", brandId],
    queryFn: () => infoFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });
  const auditQ = useQuery({
    queryKey: ["admin-audit", brandId],
    queryFn: () => auditFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const info = infoQ.data;
  const host = typeof window === "undefined" ? "—" : window.location.host;
  const env = host.includes("localhost")
    ? "Desenvolvimento"
    : host.includes("dev") || host.includes("preview")
      ? "Preview"
      : "Produção";

  const rows: Array<[string, string]> = [
    ["Cliente", info?.name ?? "—"],
    ["ID do ambiente", info?.brandId ?? "—"],
    ["Identificador", info?.slug ?? "—"],
    ["Ambiente", env],
    ["Domínio", host],
    ["Versão do sistema", APP_VERSION],
    ["Criado em", fmt(info?.createdAt)],
    ["Última atualização", fmt(info?.updatedAt)],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Informações do ambiente</h2>
        <p className="text-sm text-muted-foreground">
          Panorama técnico deste ambiente e trilha de auditoria das alterações administrativas.
        </p>
      </div>

      <PageKpiGrid>
        <PageKpi
          label="Recursos ativos"
          value={info ? `${info.featuresActive} / ${info.featuresTotal}` : "—"}
        />
        <PageKpi label="Clientes" value={info ? `${info.clients}` : "—"} />
        <PageKpi label="Membros" value={info ? `${info.members}` : "—"} />
        <PageKpi label="Versão" value={APP_VERSION} description={env} />
      </PageKpiGrid>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ambiente</CardTitle>
          <CardDescription>Somente leitura.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
              <span className="truncate font-mono text-sm">{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Auditoria administrativa</CardTitle>
          <CardDescription>
            Alterações de recursos e identidade feitas por Super Admin (últimas 50).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {auditQ.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (auditQ.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma alteração registrada ainda.
            </p>
          ) : (
            (auditQ.data ?? []).map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <span className="font-medium">{e.actorName}</span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {e.entityType === "brand_feature" ? "recurso" : "identidade"}
                </Badge>
                <span className="text-muted-foreground">
                  {e.entityType === "brand_feature"
                    ? `${e.newValue === true ? "habilitou" : "desabilitou"} ${e.featureName ?? ""}`
                    : `alterou ${e.field ?? "identidade"}`}
                </span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {fmt(e.createdAt)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

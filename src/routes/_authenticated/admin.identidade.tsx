import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Palette, Save } from "lucide-react";

import { useActiveContext } from "@/hooks/use-active-context";
import { BrandingSlots } from "@/components/settings/branding-slots";
import {
  getEnvironmentInfoFn,
  updateEnvironmentNameFn,
} from "@/lib/admin-environment.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/identidade")({
  component: AdminIdentityPage,
});

function AdminIdentityPage() {
  const { brandId } = useActiveContext();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Identidade do ambiente</h2>
        <p className="text-sm text-muted-foreground">
          White label deste ambiente. Apenas Super Admin pode alterar — usuários da marca visualizam
          o resultado final.
        </p>
      </div>

      <EnvironmentNameCard brandId={brandId!} />

      <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
        <Palette className="mt-0.5 h-5 w-5 text-primary" />
        <div className="text-sm">
          <p className="font-medium">Logos e ícone</p>
          <p className="text-muted-foreground">
            Fonte única de verdade das logos usadas no sidebar, login e favicon. As trocas aparecem
            em segundos após o envio.
          </p>
        </div>
      </div>

      <BrandingSlots brandId={brandId!} editable />
    </div>
  );
}

function EnvironmentNameCard({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const infoFn = useServerFn(getEnvironmentInfoFn);
  const renameFn = useServerFn(updateEnvironmentNameFn);
  const q = useQuery({
    queryKey: ["admin-environment", brandId],
    queryFn: () => infoFn({ data: { brandId } }),
  });
  const [name, setName] = React.useState<string>("");
  React.useEffect(() => {
    if (q.data && !name) setName(q.data.name === "—" ? "" : q.data.name);
  }, [q.data, name]);

  const m = useMutation({
    mutationFn: () => renameFn({ data: { brandId, name } }),
    onSuccess: async () => {
      toast.success("Nome do ambiente atualizado");
      await qc.invalidateQueries({ queryKey: ["admin-environment", brandId] });
      await qc.invalidateQueries({ queryKey: ["brands"] });
      await qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar nome"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Nome exibido no sistema</CardTitle>
        <CardDescription>Aparece no seletor de workspace e nos cabeçalhos.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1 space-y-1.5">
          <Label htmlFor="env-name">Nome do ambiente</Label>
          <Input
            id="env-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder={q.isLoading ? "Carregando…" : "Ex.: Taveira"}
          />
        </div>
        <Button onClick={() => m.mutate()} disabled={m.isPending || name.trim().length < 2}>
          {m.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Salvar
        </Button>
      </CardContent>
    </Card>
  );
}

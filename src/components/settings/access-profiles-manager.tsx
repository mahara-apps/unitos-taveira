import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ModulePermissionsEditor } from "@/components/settings/module-permissions-editor";
import {
  deleteAccessProfile,
  listAccessProfiles,
  saveAccessProfile,
} from "@/lib/access-profiles.functions";
import {
  emptyModulePermissions,
  type ModuleKey,
  type ModuleLevel,
  type PartialModulePermissions,
} from "@/lib/module-permissions";

/** Gestão dos perfis de acesso do workspace (presets + perfis personalizados). */
export function AccessProfilesManager({
  brandId,
  canEdit,
}: {
  brandId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const load = useServerFn(listAccessProfiles);
  const save = useServerFn(saveAccessProfile);
  const remove = useServerFn(deleteAccessProfile);

  const q = useQuery({
    queryKey: ["access-profiles", brandId],
    queryFn: () => load({ data: { brandId } }),
    enabled: !!brandId,
  });

  const profiles = q.data?.profiles ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draft, setDraft] = useState<PartialModulePermissions | null>(null);

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  const open = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setSelectedId(id);
    setDraftName(p.name);
    setDraft({ ...emptyModulePermissions(), ...p.permissions });
  };

  const startNew = () => {
    setSelectedId(null);
    setDraftName("");
    setDraft(emptyModulePermissions());
  };

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          brandId,
          ...(selectedId ? { id: selectedId } : {}),
          name: draftName.trim(),
          permissions: (draft ?? {}) as Record<ModuleKey, ModuleLevel>,
        },
      }),
    onSuccess: () => {
      toast.success("Perfil de acesso salvo.");
      qc.invalidateQueries({ queryKey: ["access-profiles", brandId] });
      qc.invalidateQueries({ queryKey: ["my-module-permissions"] });
      setDraft(null);
      setSelectedId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const del = useMutation({
    mutationFn: (id: string) => remove({ data: { brandId, id } }),
    onSuccess: () => {
      toast.success("Perfil removido.");
      qc.invalidateQueries({ queryKey: ["access-profiles", brandId] });
      setDraft(null);
      setSelectedId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" /> Perfis de acesso
          </CardTitle>
          <CardDescription>
            Cada perfil define o nível de cada módulo. Use como ponto de partida ao adicionar
            usuários — ajustes individuais continuam possíveis em cada pessoa.
          </CardDescription>
        </div>
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={startNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Novo perfil
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => open(p.id)}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  selectedId === p.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 hover:bg-muted/50"
                }`}
              >
                {p.name}
                {p.isSystem ? (
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    sistema
                  </Badge>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {draft ? (
          <div className="space-y-3 rounded-lg border border-border/60 p-4">
            <div className="grid gap-2 sm:max-w-sm">
              <Label htmlFor="profile-name">Nome do perfil</Label>
              <Input
                id="profile-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Ex.: Atendimento Sênior"
                disabled={!canEdit}
              />
            </div>
            <ModulePermissionsEditor
              value={draft}
              disabled={!canEdit}
              onChange={(key, level) => setDraft((prev) => ({ ...(prev ?? {}), [key]: level }))}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {selected && !selected.isSystem && canEdit ? (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => del.mutate(selected.id)}
                  disabled={del.isPending}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remover
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(null);
                  setSelectedId(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => mut.mutate()}
                disabled={!canEdit || mut.isPending || draftName.trim().length < 2}
              >
                {mut.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                Salvar perfil
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Selecione um perfil acima para ver e ajustar os níveis por módulo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

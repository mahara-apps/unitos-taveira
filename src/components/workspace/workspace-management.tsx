/**
 * Área REAL de administração do workspace (= `brands`, identidade da instalação).
 *
 * Substitui o antigo menu contextual (popover) da sidebar: aqui a lista de
 * workspaces, o destaque do selecionado e as ações (Editar / Inativar /
 * Excluir) vivem numa única superfície hierárquica.
 *
 * RBAC: a matriz de UI é `workspaceAdminActions` (fonte única) e o servidor
 * (`updateBrand`, `setBrandActive`, `deleteBrand` + RLS de `brands`) continua
 * sendo a autoridade real.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  Loader2,
  Pencil,
  PowerOff,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteBrand, setBrandActive, updateBrand } from "@/lib/workspace.functions";
import { useAccessRole } from "@/hooks/use-access-role";
import { useActiveContext } from "@/hooks/use-active-context";
import { useMyBrandsQuery, type MyBrand } from "@/hooks/use-my-brands";
import { resetScopeCache } from "@/lib/session-reset";
import { isDeleteConfirmationValid, workspaceAdminActions } from "@/lib/workspace-admin";

const SWATCHES = [
  "#8b5cf6",
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#64748b",
];

export function WorkspaceManagement() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { brandId, setBrandId, clientId, setClientId } = useActiveContext();
  const { authorityRole, brandRole } = useAccessRole();
  const brandsQ = useMyBrandsQuery();
  const brands: MyBrand[] = brandsQ.data ?? [];
  const active = brands.find((b) => b.id === brandId) ?? null;
  const actions = workspaceAdminActions(authorityRole, brandRole);

  const activeList = brands.filter((b) => b.is_active !== false);
  const inactiveList = brands.filter((b) => b.is_active === false);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SWATCHES[0]!);
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    if (!editOpen || !active) return;
    setName(active.name);
    setColor(active.color ?? SWATCHES[0]!);
  }, [editOpen, active]);

  const update = useServerFn(updateBrand);
  const toggleActive = useServerFn(setBrandActive);
  const remove = useServerFn(deleteBrand);

  const updateMut = useMutation({
    mutationFn: () => update({ data: { brandId: brandId!, patch: { name: name.trim(), color } } }),
    onSuccess: (brand) => {
      // Atualização imediata do seletor/header/sidebar via cache canônico.
      qc.setQueryData<MyBrand[]>(["brands"], (prev) =>
        (prev ?? []).map((b) =>
          b.id === brand.id ? { ...b, name: brand.name, color: brand.color, slug: brand.slug } : b,
        ),
      );
      void qc.invalidateQueries({ queryKey: ["brands"], refetchType: "none" });
      toast.success("Workspace atualizado");
      setEditOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeMut = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      toggleActive({ data: { brandId: vars.id, isActive: vars.isActive } }),
    onSuccess: (brand) => {
      qc.setQueryData<MyBrand[]>(["brands"], (prev) =>
        (prev ?? []).map((b) => (b.id === brand.id ? { ...b, is_active: brand.is_active } : b)),
      );
      void qc.invalidateQueries({ queryKey: ["brands"], refetchType: "none" });
      toast.success(brand.is_active ? "Workspace reativado" : "Workspace inativado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => remove({ data: { brandId: brandId!, confirmName } }),
    onSuccess: (res) => {
      const remaining = brands.filter((b) => b.id !== res.id);
      qc.setQueryData<MyBrand[]>(["brands"], remaining);
      setDeleteOpen(false);
      setConfirmName("");
      toast.success(`Workspace "${res.name}" excluído`);
      const next = remaining.find((b) => b.is_active !== false)?.id ?? remaining[0]?.id ?? null;
      setClientId(null);
      setBrandId(next);
      resetScopeCache(qc, [next, res.id, clientId]);
      void navigate({ to: "/dashboard", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const select = (id: string) => {
    if (id === brandId) return;
    setClientId(null);
    setBrandId(id);
    resetScopeCache(qc, [id, brandId, clientId]);
  };

  const confirmOk = isDeleteConfirmationValid(confirmName, active?.name);

  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Workspaces</CardTitle>
          <CardDescription>
            Cada workspace é uma instalação independente: clientes, integrações e membros são
            isolados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {brandsQ.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : brands.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum workspace disponível para a sua conta.
            </p>
          ) : (
            <>
              <WorkspaceList
                items={activeList}
                activeId={brandId}
                onSelect={select}
                emptyLabel="Nenhum workspace ativo."
              />

              {inactiveList.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Inativos
                  </p>
                  <WorkspaceList
                    items={inactiveList}
                    activeId={brandId}
                    onSelect={select}
                    emptyLabel=""
                  />
                </div>
              ) : null}
            </>
          )}

          {active && actions.hasAny ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-3">
              <div className="mr-auto min-w-0 text-sm">
                <p className="truncate font-medium">{active.name}</p>
                <p className="text-xs text-muted-foreground">Ações do workspace selecionado</p>
              </div>
              {actions.canEdit ? (
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                </Button>
              ) : null}
              {actions.canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activeMut.isPending}
                  onClick={() =>
                    activeMut.mutate({ id: active.id, isActive: active.is_active === false })
                  }
                >
                  {active.is_active === false ? (
                    <>
                      <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reativar
                    </>
                  ) : (
                    <>
                      <PowerOff className="mr-2 h-3.5 w-3.5" /> Inativar
                    </>
                  )}
                </Button>
              ) : null}
              {actions.canDelete ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setConfirmName("");
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar workspace</DialogTitle>
            <DialogDescription>
              Identidade da instalação. Clientes, projetos e integrações não são afetados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ws-name">Nome</Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Minha agência"
              />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Cor ${c}`}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-md border transition ${
                      color === c ? "border-foreground scale-110" : "border-border/60"
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => updateMut.mutate()}
              disabled={name.trim().length < 2 || updateMut.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir workspace</DialogTitle>
            <DialogDescription>Esta ação é permanente e não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertTitle>Impacto da exclusão</AlertTitle>
            <AlertDescription>
              Todos os clientes, briefings, pautas, projetos, tarefas, publicações, conexões e
              membros deste workspace serão removidos junto com ele. Outras instalações/workspaces
              não são afetados. Se quiser apenas tirá-lo de circulação, use{" "}
              <span className="font-medium">Inativar</span>.
            </AlertDescription>
          </Alert>
          <div className="space-y-2">
            <Label htmlFor="ws-confirm">
              Digite <span className="font-semibold">{active?.name}</span> para confirmar
            </Label>
            <Input
              id="ws-confirm"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={active?.name ?? ""}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMut.mutate()}
              disabled={!confirmOk || deleteMut.isPending}
            >
              Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WorkspaceList({
  items,
  activeId,
  onSelect,
  emptyLabel,
}: {
  items: MyBrand[];
  activeId: string | null;
  onSelect: (id: string) => void;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return emptyLabel ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : null;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((b) => {
        const selected = b.id === activeId;
        return (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onSelect(b.id)}
              aria-current={selected ? "true" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border/60 hover:bg-muted/50"
              }`}
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                style={{ background: b.color ?? "linear-gradient(135deg,#8b5cf6,#6366f1)" }}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.name}</p>
                <p className="truncate text-xs text-muted-foreground">{b.role}</p>
              </div>
              {b.is_active === false ? (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  Inativo
                </Badge>
              ) : null}
              {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

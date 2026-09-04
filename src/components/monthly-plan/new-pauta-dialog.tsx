// Fluxo único de criação manual de pauta: dados essenciais + organização.
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeError } from "@/lib/errors";
import { createMonthlyPlanFn, setPlanProjectFn } from "@/lib/monthly-plans.functions";
import {
  PautaOrganizationField,
  emptyOrganization,
  requiredOrganization,
  toOrganizationInput,
  type OrganizationDraft,
} from "@/components/monthly-plan/pauta-organization-field";

export function NewPautaDialog({
  open,
  onOpenChange,
  brandId,
  clientId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  clientId: string;
  onCreated?: (planId: string) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [org, setOrg] = React.useState<OrganizationDraft>(requiredOrganization);

  React.useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setOrg(requiredOrganization);
    }
  }, [open]);

  const qc = useQueryClient();
  const createPlan = useServerFn(createMonthlyPlanFn);
  // Projeto é obrigatório na criação: "nenhum" não é aceito.
  const organization = toOrganizationInput(org, false);
  const canSave = title.trim().length > 0 && organization !== null;


  const m = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("organization_incomplete");
      return createPlan({
        data: {
          brandId,
          clientId,
          title: title.trim(),
          description: description.trim() || null,
          organization,
        },
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan-board", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["monthly-plans", "list", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["plan-project-options", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(res.projectId ? "Pauta criada e vinculada ao projeto." : "Pauta criada.");
      onOpenChange(false);
      onCreated?.(res.planId);
    },
    onError: (err) => toast.error(`Não foi possível criar a pauta: ${describeError(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova pauta</DialogTitle>
          <DialogDescription>
            Crie a unidade editorial e escolha como ela será organizada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pauta-title" className="text-xs">
              Título da pauta
            </Label>
            <Input
              id="pauta-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Pauta de agosto"
              maxLength={240}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pauta-desc" className="text-xs">
              Contexto <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="pauta-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="O que essa pauta precisa cobrir"
            />
          </div>

          <div className="h-px bg-border/60" />

          <PautaOrganizationField
            brandId={brandId}
            clientId={clientId}
            value={org}
            onChange={setOrg}
            allowNone={false}
          />

        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => m.mutate()} disabled={!canSave || m.isPending}>
            {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar pauta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reaproveita o mesmo conceito de organização para pautas já existentes. */
export function LinkPautaProjectDialog({
  open,
  onOpenChange,
  brandId,
  clientId,
  planId,
  planTitle,
  requireProject = false,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  clientId: string;
  planId: string;
  planTitle: string;
  /** Quando true, "nenhum projeto" não é aceito (pauta precisa de projeto). */
  requireProject?: boolean;
  onLinked?: (projectId: string | null) => void;
}) {
  const [org, setOrg] = React.useState<OrganizationDraft>(
    requireProject ? requiredOrganization : emptyOrganization,
  );
  React.useEffect(() => {
    if (open) setOrg(requireProject ? requiredOrganization : emptyOrganization);
  }, [open, requireProject]);

  const qc = useQueryClient();
  const setPlanProject = useServerFn(setPlanProjectFn);
  const organization = toOrganizationInput(org, !requireProject);

  const m = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("organization_incomplete");
      return setPlanProject({ data: { planId, brandId, clientId, organization } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan-board", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["plan-project-options", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["monthly-plan", planId] });
      toast.success(res.projectId ? "Pauta vinculada ao projeto." : "Pauta sem projeto.");
      onOpenChange(false);
      onLinked?.(res.projectId);
    },
    onError: (err) => toast.error(`Não foi possível vincular: ${describeError(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Organizar pauta</DialogTitle>
          <DialogDescription className="line-clamp-1">{planTitle}</DialogDescription>
        </DialogHeader>
        <PautaOrganizationField
          brandId={brandId}
          clientId={clientId}
          value={org}
          onChange={setOrg}
          allowNone={!requireProject}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => m.mutate()} disabled={!organization || m.isPending}>
            {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

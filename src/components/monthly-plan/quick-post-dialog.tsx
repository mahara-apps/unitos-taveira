/**
 * Peça expressa: a ideia em uma linha vira uma peça em Produção com a legenda
 * já escrita pelos agentes. A legenda volta para revisão antes de seguir — a
 * peça nasce no primeiro estágio, nunca agendada nem publicada.
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PenLine, RefreshCw, Wand2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/errors";
import {
  PautaOrganizationField,
  requiredOrganization,
  toOrganizationInput,
  type OrganizationDraft,
} from "@/components/monthly-plan/pauta-organization-field";
import { PLAN_CHANNELS, PLAN_CHANNEL_LABEL } from "@/lib/monthly-plan-fields";
import type { PlanChannel } from "@/lib/monthly-plan-fields";
import { CONTENT_FORMAT_LABEL, formatsForChannel, type ContentFormat } from "@/lib/content-formats";
import { updatePostFn } from "@/lib/content.functions";
import { quickPostFn, type QuickPostResult } from "@/lib/quick-content.functions";

export function QuickPostDialog({
  open,
  onOpenChange,
  brandId,
  clientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  clientId: string;
}) {
  const qc = useQueryClient();
  const quickPost = useServerFn(quickPostFn);
  const updatePost = useServerFn(updatePostFn);

  const [organization, setOrganization] = React.useState<OrganizationDraft>(requiredOrganization);
  const [idea, setIdea] = React.useState("");
  const [channel, setChannel] = React.useState<PlanChannel>(PLAN_CHANNELS[0]!);
  const formats = React.useMemo(() => formatsForChannel(channel), [channel]);
  const [format, setFormat] = React.useState<ContentFormat>(formats[0]!);
  React.useEffect(() => {
    if (!formats.includes(format)) setFormat(formats[0]!);
  }, [formats, format]);

  const [result, setResult] = React.useState<QuickPostResult | null>(null);
  const [draftTitle, setDraftTitle] = React.useState("");
  const [draftCopy, setDraftCopy] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      setIdea("");
    }
  }, [open]);

  const orgInput = toOrganizationInput(organization, false);
  const projectId = orgInput?.mode === "existing" ? orgInput.projectId : null;

  const run = useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error("Escolha um projeto existente para esta peça.");
      return quickPost({
        data: { brandId, clientId, projectId, idea: idea.trim(), channel, format },
      });
    },
    onMutate: () => setError(null),
    onSuccess: (res: QuickPostResult) => {
      setResult(res);
      setDraftTitle(res.title);
      setDraftCopy(res.copy ?? "");
      qc.invalidateQueries({ queryKey: ["content-board"] });
      if (res.copyError) toast.warning(res.copyError);
      else toast.success("Peça criada com a legenda escrita. Revise antes de seguir.");
    },
    onError: (err) => {
      const msg = describeError(err);
      setError(msg);
      toast.error(msg);
    },
  });

  const save = useMutation({
    mutationFn: () => {
      if (!result) throw new Error("Nada para salvar.");
      return updatePost({
        data: { postId: result.postId, patch: { title: draftTitle.trim(), copy: draftCopy } },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content-board"] });
      toast.success("Peça salva em Produção.");
      onOpenChange(false);
    },
    onError: (err) => toast.error(describeError(err)),
  });

  const busy = run.isPending || save.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="w-full max-w-lg overflow-hidden"
        onInteractOutside={(e) => busy && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Peça expressa
          </DialogTitle>
          <DialogDescription>
            Escreva a ideia em uma linha. A peça nasce em Produção com a legenda escrita — você
            revisa antes de seguir. O limite mensal contratado continua valendo.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <PautaOrganizationField
              brandId={brandId}
              clientId={clientId}
              value={organization}
              onChange={setOrganization}
              allowNone={false}
            />
            {organization.mode === "new" && (
              <p className="text-xs text-muted-foreground">
                A peça expressa exige um projeto que já existe. Crie o projeto na pauta e volte
                aqui.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="quick-idea" className="text-xs">
                A ideia <span className="text-primary">*</span>
              </Label>
              <Textarea
                id="quick-idea"
                rows={3}
                disabled={busy}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Ex.: post mostrando o antes e depois do atendimento da semana"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Onde vai publicar
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {PLAN_CHANNELS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={busy}
                    onClick={() => setChannel(c)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      channel === c
                        ? "border-primary/60 bg-primary/[0.08] text-foreground"
                        : "border-border/60 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {PLAN_CHANNEL_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Formato
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {formats.map((f) => (
                  <button
                    key={f}
                    type="button"
                    disabled={busy}
                    onClick={() => setFormat(f)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      format === f
                        ? "border-primary/60 bg-primary/[0.08] text-foreground"
                        : "border-border/60 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {CONTENT_FORMAT_LABEL[f]}
                  </button>
                ))}
              </div>
            </div>

            {run.isPending && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-2.5 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>Escrevendo a legenda…</span>
              </div>
            )}
            {error && !run.isPending && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {result.copyError && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
                {result.copyError} A peça já está em Produção e a legenda pode ser gerada de novo
                por lá.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="quick-title" className="text-xs">
                Título
              </Label>
              <Input
                id="quick-title"
                value={draftTitle}
                disabled={busy}
                onChange={(e) => setDraftTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-copy" className="text-xs">
                Legenda
              </Label>
              <Textarea
                id="quick-copy"
                rows={10}
                value={draftCopy}
                disabled={busy}
                onChange={(e) => setDraftCopy(e.target.value)}
                placeholder="A legenda ainda não foi escrita."
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {result ? "Fechar" : "Cancelar"}
          </Button>
          {!result ? (
            <Button
              variant="ai"
              className="gap-2"
              disabled={busy || !projectId || idea.trim().length < 4}
              onClick={() => run.mutate()}
            >
              {run.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : error ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {run.isPending ? "Criando…" : error ? "Tentar de novo" : "Criar peça agora"}
            </Button>
          ) : (
            <Button className="gap-2" disabled={busy} onClick={() => save.mutate()}>
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PenLine className="h-4 w-4" />
              )}
              Salvar peça
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

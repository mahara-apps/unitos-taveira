/**
 * Aplicação em massa sobre rascunhos selecionados no calendário.
 *
 * Só o que estiver marcado é alterado. A agenda entra como PROPOSTA — a
 * reserva continua passando pela aprovação interna/cliente existente.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Layers, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/errors";
import { listClientSocialConnectionsFn } from "@/lib/scheduling-wizard.functions";
import { bulkUpdateDraftsFn } from "@/lib/drafts-bulk.functions";
import type { BulkApplyResult } from "@/lib/drafts-bulk.server";

const FORMATS = [
  { key: "feed", label: "Feed" },
  { key: "stories", label: "Stories" },
  { key: "reels", label: "Reels" },
  { key: "carrossel", label: "Carrossel" },
] as const;

const WEEKDAYS = [
  { key: "auto", label: "Distribuir automaticamente" },
  { key: "1", label: "Segunda" },
  { key: "2", label: "Terça" },
  { key: "3", label: "Quarta" },
  { key: "4", label: "Quinta" },
  { key: "5", label: "Sexta" },
  { key: "6", label: "Sábado" },
  { key: "0", label: "Domingo" },
] as const;

export function BulkApplyDialog({
  open,
  onOpenChange,
  brandId,
  clientId,
  postIds,
  monthAnchor,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  clientId: string;
  postIds: string[];
  monthAnchor?: Date | null;
  onApplied?: () => void;
}) {
  const qc = useQueryClient();
  const listConnections = useServerFn(listClientSocialConnectionsFn);
  const applyBulk = useServerFn(bulkUpdateDraftsFn);

  const [useDestinations, setUseDestinations] = useState(false);
  const [destMode, setDestMode] = useState<"replace" | "add">("add");
  const [connIds, setConnIds] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>(["feed"]);

  const [useSchedule, setUseSchedule] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"suggest" | "fixed">("suggest");
  const [weekday, setWeekday] = useState<string>("auto");
  const [time, setTime] = useState("19:00");
  const [overwrite, setOverwrite] = useState(false);

  const [useCaption, setUseCaption] = useState(false);
  const [hashtags, setHashtags] = useState("");
  const [firstComment, setFirstComment] = useState("");

  const [sendToProduction, setSendToProduction] = useState(false);
  const [result, setResult] = useState<BulkApplyResult | null>(null);

  const connectionsQ = useQuery({
    enabled: open,
    queryKey: ["wizard-connections", brandId, clientId],
    queryFn: () => listConnections({ data: { brandId, clientId } }),
  });

  const connections = connectionsQ.data ?? [];

  const destinationList = useMemo(() => {
    const out: Array<{ connectionId: string; channel: string; format: string }> = [];
    for (const id of connIds) {
      const conn = connections.find((c) => c.connectionId === id);
      if (!conn) continue;
      for (const f of formats) out.push({ connectionId: id, channel: conn.channel, format: f });
    }
    return out;
  }, [connIds, formats, connections]);

  const nothingSelected =
    !useDestinations && !useSchedule && !useCaption && !sendToProduction;

  const mut = useMutation({
    mutationFn: () =>
      applyBulk({
        data: {
          brandId,
          clientId,
          postIds,
          destinations:
            useDestinations && destinationList.length
              ? { mode: destMode, list: destinationList as never }
              : null,
          schedule: useSchedule
            ? {
                mode: scheduleMode,
                weekday: scheduleMode === "fixed" && weekday !== "auto" ? Number(weekday) : null,
                time: scheduleMode === "fixed" ? time : null,
                overwrite,
                monthAnchor: (monthAnchor ?? new Date()).toISOString(),
              }
            : null,
          hashtags: useCaption
            ? hashtags
                .split(/[\s,]+/)
                .map((h) => h.replace(/^#/, "").trim())
                .filter(Boolean)
            : null,
          firstComment: useCaption && firstComment.trim() ? firstComment.trim() : null,
          sendToProduction,
        },
      }),
    onSuccess: (res) => {
      setResult(res);
      void qc.invalidateQueries({ queryKey: ["publication-board"] });
      void qc.invalidateQueries({ queryKey: ["calendar-drafts"] });
      void qc.invalidateQueries({ queryKey: ["calendar-undated"] });
      onApplied?.();
      if (res.errors === 0 && res.applied > 0) {
        toast.success(`${res.applied} peça(s) atualizada(s) em lote.`);
      } else if (res.errors > 0) {
        toast.warning(`${res.applied} aplicada(s), ${res.errors} com erro.`);
      } else {
        toast.info("Nenhuma peça foi alterada.");
      }
    },
    onError: (e) => toast.error(describeError(e)),
  });

  function toggle<T>(list: T[], v: T, set: (l: T[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setResult(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> Aplicar em massa
          </DialogTitle>
          <DialogDescription>
            {postIds.length} rascunho(s) selecionado(s). Só os blocos marcados são alterados — nada
            é publicado automaticamente.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> {result.applied} aplicada(s)
              </Badge>
              <Badge variant="outline">{result.skipped} ignorada(s)</Badge>
              {result.errors ? (
                <Badge variant="destructive">{result.errors} com erro</Badge>
              ) : null}
              {result.scheduleConfidence ? (
                <Badge variant="secondary">
                  Confiança do horário: {result.scheduleConfidence} ({result.scheduleSample ?? 0}{" "}
                  publicações)
                </Badge>
              ) : null}
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2 text-xs">
              {result.items.map((it) => (
                <li key={it.postId} className="flex items-start justify-between gap-2">
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {it.postId.slice(0, 8)}
                  </span>
                  <span
                    className={cn(
                      "text-right",
                      it.status === "error"
                        ? "text-destructive"
                        : it.status === "applied"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground",
                    )}
                  >
                    {it.status === "applied"
                      ? it.proposedAt
                        ? `Aplicada · proposta ${new Date(it.proposedAt).toLocaleString("pt-BR")}`
                        : "Aplicada"
                      : (it.reason ?? it.status)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ---------------------------------------------------- destinos */}
            <section className="rounded-lg border border-border/60 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={useDestinations}
                  onCheckedChange={(v) => setUseDestinations(v === true)}
                />
                Definir conta, canal e formato
              </label>
              {useDestinations ? (
                <div className="mt-3 space-y-3">
                  {connectionsQ.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Carregando contas…
                    </div>
                  ) : connections.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma conta vinculada a este cliente. Vincule em Perfil do cliente &gt;
                      Canais.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {connections.map((c) => (
                        <label
                          key={c.connectionId}
                          className="flex items-center gap-2 text-xs"
                        >
                          <Checkbox
                            checked={connIds.includes(c.connectionId)}
                            onCheckedChange={() =>
                              toggle(connIds, c.connectionId, setConnIds)
                            }
                          />
                          <span className="font-medium">{c.accountLabel}</span>
                          <span className="text-muted-foreground">
                            {c.channel}
                            {c.handle ? ` · @${c.handle}` : ""}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {FORMATS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => toggle(formats, f.key as string, setFormats)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          formats.includes(f.key)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/70 text-muted-foreground hover:bg-muted/60",
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <Label className="text-xs">Modo</Label>
                    <Select
                      value={destMode}
                      onValueChange={(v) => setDestMode(v as "replace" | "add")}
                    >
                      <SelectTrigger className="h-8 w-56 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="add">Adicionar aos destinos atuais</SelectItem>
                        <SelectItem value="replace">Substituir destinos atuais</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {destinationList.length ? (
                    <p className="text-[11px] text-muted-foreground">
                      {destinationList.length} destino(s) por peça.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            {/* ------------------------------------------------------ agenda */}
            <section className="rounded-lg border border-border/60 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={useSchedule}
                  onCheckedChange={(v) => setUseSchedule(v === true)}
                />
                Propor dia e horário
              </label>
              {useSchedule ? (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-3 text-xs">
                    <Select
                      value={scheduleMode}
                      onValueChange={(v) => setScheduleMode(v as "suggest" | "fixed")}
                    >
                      <SelectTrigger className="h-8 w-64 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="suggest">
                          Melhores horários (persona + histórico)
                        </SelectItem>
                        <SelectItem value="fixed">Dia e hora definidos por mim</SelectItem>
                      </SelectContent>
                    </Select>
                    {scheduleMode === "suggest" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Sparkles className="h-3 w-3" /> mesma base das pautas
                      </span>
                    ) : null}
                  </div>
                  {scheduleMode === "fixed" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={weekday} onValueChange={setWeekday}>
                        <SelectTrigger className="h-8 w-56 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAYS.map((w) => (
                            <SelectItem key={w.key} value={w.key}>
                              {w.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="h-8 w-28 text-xs"
                      />
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={overwrite}
                      onCheckedChange={(v) => setOverwrite(v === true)}
                    />
                    Sobrescrever propostas que já têm data
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Horários no fuso America/Sao_Paulo. Peças já agendadas ou publicadas nunca são
                    alteradas.
                  </p>
                </div>
              ) : null}
            </section>

            {/* --------------------------------------------------- legenda */}
            <section className="rounded-lg border border-border/60 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={useCaption}
                  onCheckedChange={(v) => setUseCaption(v === true)}
                />
                Acrescentar hashtags / primeiro comentário
              </label>
              {useCaption ? (
                <div className="mt-3 space-y-2">
                  <Input
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    placeholder="#marca #campanha"
                    className="h-8 text-xs"
                  />
                  <Textarea
                    value={firstComment}
                    onChange={(e) => setFirstComment(e.target.value)}
                    placeholder="Primeiro comentário (opcional)"
                    rows={3}
                    className="text-xs"
                  />
                </div>
              ) : null}
            </section>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sendToProduction}
                onCheckedChange={(v) => setSendToProduction(v === true)}
              />
              Mover as peças para Produção
            </label>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                disabled={nothingSelected || mut.isPending}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Aplicar em {postIds.length} peça(s)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

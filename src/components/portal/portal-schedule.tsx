/**
 * Portal do Cliente — "Datas para confirmar".
 *
 * O cliente vê as datas e horários propostos pela equipe e confirma ou pede
 * outra data. Confirmar apenas reserva a data — nada é publicado aqui.
 * Também é possível selecionar várias datas e responder de uma vez.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, Check, CheckSquare, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { usePortalApi, usePortalCanInteract } from "./portal-context";
import { ListSkeleton } from "./portal-shared";
import { formatDateTimeBr } from "@/lib/timezone";

const STATUS_LABEL: Record<string, string> = {
  internal_approved: "Aguardando sua confirmação",
  client_pending: "Aguardando sua confirmação",
  client_changes: "Você pediu outra data",
  reserved: "Data confirmada",
};

function dateLabel(iso: string) {
  return formatDateTimeBr(iso);
}

export function PortalSchedule({ month }: { month: string }) {
  const api = usePortalApi();
  const qc = useQueryClient();
  const [asking, setAsking] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkComment, setBulkComment] = useState("");
  const [bulkAsking, setBulkAsking] = useState(false);

  const { from, to } = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y as number, (m as number) - 1, 1));
    const end = new Date(Date.UTC(y as number, m as number, 1));
    return { from: start.toISOString(), to: end.toISOString() };
  }, [month]);

  const key = ["portal", "schedule", api.scopeKey, month];
  const q = useQuery({ queryKey: key, queryFn: () => api.schedule(from, to) });

  const canAct = usePortalCanInteract("calendar");
  const decide = useMutation({
    mutationFn: (input: {
      postIds: string[];
      decision: "approve" | "changes";
      comment?: string;
    }) =>
      canAct
        ? api.decideSchedule(input)
        : Promise.reject(new Error("Este acesso é somente de acompanhamento.")),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.decision === "approve"
          ? vars.postIds.length > 1
            ? `${vars.postIds.length} datas confirmadas!`
            : "Data confirmada!"
          : "Pedido de nova data enviado.",
      );
      setAsking(null);
      setComment("");
      setBulkAsking(false);
      setBulkComment("");
      setSelectMode(false);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["portal", "calendar", api.scopeKey, month] });
    },
    onError: (err) =>
      toast.error("Não foi possível registrar sua resposta", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const items = q.data ?? [];
  const pending = items.filter((i) => i.scheduleStatus !== "reserved");
  const pendingIds = pending.map((i) => i.postId);
  const selectedIds = pendingIds.filter((id) => selected.has(id));
  const allSelected = pendingIds.length > 0 && selectedIds.length === pendingIds.length;
  const canBatch = canAct && pending.length > 1;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (q.isLoading) return <ListSkeleton />;
  if (q.isError || items.length === 0) return null;

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/[0.03]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarCheck2 className="h-4 w-4 text-primary" />
            Datas para confirmar
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Confirmar reserva a data no calendário. Nada é publicado sem sua aprovação de conteúdo.
          </p>
        </div>
        {canBatch ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
              setBulkAsking(false);
            }}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {selectMode ? "Cancelar seleção" : "Selecionar várias"}
          </Button>
        ) : null}
      </header>

      {selectMode ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 bg-primary/[0.04] px-4 py-2.5">
          <button
            type="button"
            onClick={() => setSelected(allSelected ? new Set() : new Set(pendingIds))}
            className="text-[12px] font-bold text-primary underline-offset-2 hover:underline"
          >
            {allSelected ? "Limpar seleção" : `Selecionar todas (${pendingIds.length})`}
          </button>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              disabled={selectedIds.length === 0 || decide.isPending}
              onClick={() => setBulkAsking((v) => !v)}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Pedir outra data
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1"
              disabled={selectedIds.length === 0 || decide.isPending}
              onClick={() => decide.mutate({ postIds: selectedIds, decision: "approve" })}
            >
              {decide.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Confirmar ({selectedIds.length})
            </Button>
          </div>
          {bulkAsking ? (
            <div className="w-full space-y-2">
              <Textarea
                value={bulkComment}
                onChange={(e) => setBulkComment(e.target.value)}
                rows={2}
                placeholder="Quais dias e horários funcionam melhor para você?"
                className="text-xs"
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => setBulkAsking(false)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={decide.isPending || bulkComment.trim().length < 3}
                  onClick={() =>
                    decide.mutate({
                      postIds: selectedIds,
                      decision: "changes",
                      comment: bulkComment.trim(),
                    })
                  }
                >
                  Enviar pedido ({selectedIds.length})
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y divide-primary/10">
        {items.map((item) => {
          const selectable = selectMode && item.scheduleStatus !== "reserved";
          return (
            <li key={item.postId} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  {selectable ? (
                    <Checkbox
                      checked={selected.has(item.postId)}
                      onCheckedChange={() => toggleOne(item.postId)}
                      aria-label="Selecionar data"
                      className="mt-0.5 h-4.5 w-4.5 shrink-0"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {dateLabel(item.proposedAt)} ·{" "}
                      {STATUS_LABEL[item.scheduleStatus] ?? item.scheduleStatus}
                      {item.channels.length ? ` · ${item.channels.join(", ")}` : ""}
                    </p>
                    {item.rationale ? (
                      <p className="mt-1 text-[11px] text-muted-foreground/90">{item.rationale}</p>
                    ) : null}
                  </div>
                </div>
                {item.scheduleStatus === "reserved" ? (
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    Confirmada
                  </span>
                ) : selectMode ? null : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      className="h-8 gap-1"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ postIds: [item.postId], decision: "approve" })}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Confirmar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      onClick={() => setAsking(asking === item.postId ? null : item.postId)}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Pedir outra data
                    </Button>
                  </div>
                )}
              </div>

              {asking === item.postId ? (
                <div className="mt-2 space-y-2">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    placeholder="Qual dia e horário funciona melhor para você?"
                    className="text-xs"
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => setAsking(null)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={decide.isPending || comment.trim().length === 0}
                      onClick={() =>
                        decide.mutate({
                          postIds: [item.postId],
                          decision: "changes",
                          comment: comment.trim(),
                        })
                      }
                    >
                      Enviar pedido
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

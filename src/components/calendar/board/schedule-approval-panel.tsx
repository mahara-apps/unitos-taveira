/**
 * Painel de APROVAÇÃO DE AGENDA (interna).
 *
 * Mostra as datas/horas sugeridas pela IA para as peças da pauta e permite
 * aprovar em lote ou uma a uma, editar o slot ou remover a proposta.
 * Aprovar aqui NÃO publica e NÃO agenda na fila: envia a data para o cliente
 * confirmar no Portal e, com a confirmação, a data fica reservada.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Check, Copy, ExternalLink, Loader2, Lock, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PublicationItem } from "@/lib/calendar-board.functions";
import {
  approveScheduleFn,
  clearScheduleSlotFn,
  getClientScheduleLinkFn,
  reserveScheduleFn,
  updateScheduleSlotFn,
} from "@/lib/schedule-approval.functions";
import { useAccessRole } from "@/hooks/use-access-role";
import { PUBLICATION_STATUS, formatLabel } from "@/lib/publication-status-tokens";

const SCHEDULE_LABEL: Record<string, string> = {
  proposed: "Sugerida pela IA",
  internal_approved: "Aprovada internamente",
  client_pending: "Aguardando o cliente confirmar no Portal",
  client_changes: "Cliente pediu outra data",
  reserved: "Data reservada",
};

/** "2026-09-03T19:00" para o input datetime-local, em hora local do usuário. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleApprovalPanel({
  brandId,
  clientId,
  items,
  onOpen,
}: {
  brandId: string;
  clientId: string;
  items: PublicationItem[];
  onOpen: (item: PublicationItem) => void;
}) {
  const qc = useQueryClient();
  const approve = useServerFn(approveScheduleFn);
  const reserve = useServerFn(reserveScheduleFn);
  const getLink = useServerFn(getClientScheduleLinkFn);
  const { authorityRole } = useAccessRole();
  // Owner mapeia para `admin` na autoridade canônica; manager/user não reservam.
  const canReserveDirect = authorityRole === "admin" || authorityRole === "super_admin";
  const [linkPath, setLinkPath] = useState<string | null>(null);
  const updateSlot = useServerFn(updateScheduleSlotFn);
  const clearSlot = useServerFn(clearScheduleSlotFn);

  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ postId: string; value: string } | null>(null);

  const pending = useMemo(
    () =>
      items
        .filter((i) => !!i.proposedAt && i.scheduleStatus !== "reserved")
        .sort((a, b) => (a.proposedAt ?? "").localeCompare(b.proposedAt ?? "")),
    [items],
  );

  const approvable = useMemo(
    () => pending.filter((i) => ["proposed", "client_changes"].includes(i.scheduleStatus)),
    [pending],
  );

  if (pending.length === 0) return null;

  const absoluteLink = linkPath
    ? `${typeof window === "undefined" ? "" : window.location.origin}${linkPath}`
    : null;

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado. Envie ao cliente pelo canal que preferir.");
    } catch {
      toast.error("Não foi possível copiar", { description: url });
    }
  };

  const loadLink = async () => {
    setBusy(true);
    try {
      const link = await getLink({ data: { brandId, clientId } });
      if (link) setLinkPath(link.path);
      else toast.error("Não foi possível gerar o link do Portal para este cliente.");
    } catch (err) {
      toast.error("Não foi possível gerar o link", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const runReserve = async (postIds: string[]) => {
    if (postIds.length === 0) return;
    setBusy(true);
    try {
      const res = await reserve({ data: { brandId, clientId, postIds } });
      toast.success(
        res.updated === 1 ? "Data reservada." : `${res.updated} datas reservadas.`,
        { description: "Reservar apenas fixa a data — nada é publicado." },
      );
      setSelected([]);
      refresh();
    } catch (err) {
      toast.error("Não foi possível reservar", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["publication-board"] });
  };

  const runApprove = async (postIds: string[]) => {
    if (postIds.length === 0) return;
    setBusy(true);
    try {
      const res = await approve({ data: { brandId, clientId, postIds } });
      const path = res.link?.path ?? null;
      if (path) setLinkPath(path);
      const url = path
        ? `${typeof window === "undefined" ? "" : window.location.origin}${path}`
        : null;
      toast.success(
        res.updated === 1
          ? "Agenda aprovada — envie o link do Portal para o cliente confirmar."
          : `${res.updated} datas aprovadas — envie o link do Portal para o cliente confirmar.`,
        {
          ...(res.skipped > 0
            ? { description: `${res.skipped} item(ns) já não estavam aguardando aprovação interna.` }
            : {}),
          ...(url ? { action: { label: "Copiar link", onClick: () => void copyLink(url) } } : {}),
        },
      );
      setSelected([]);
      refresh();
    } catch (err) {
      toast.error("Não foi possível aprovar a agenda", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveSlot = async () => {
    if (!editing) return;
    const at = new Date(editing.value);
    if (Number.isNaN(at.getTime())) {
      toast.error("Data inválida");
      return;
    }
    setBusy(true);
    try {
      await updateSlot({
        data: { brandId, clientId, postId: editing.postId, proposedAt: at.toISOString() },
      });
      toast.success("Nova data proposta salva.");
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error("Não foi possível salvar a data", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (postId: string) => {
    setBusy(true);
    try {
      await clearSlot({ data: { brandId, clientId, postId } });
      toast.success("Proposta de agenda removida.");
      refresh();
    } catch (err) {
      toast.error("Não foi possível remover a proposta", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/[0.03]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Agenda sugerida ({pending.length})
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Aprovar gera o link do Portal para o cliente confirmar a data — nada é publicado nem
            agendado automaticamente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.length > 0 ? (
            <Button size="sm" className="h-8 gap-1.5" disabled={busy} onClick={() => runApprove(selected)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Aprovar {selected.length} selecionada(s)
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={busy || approvable.length === 0}
            onClick={() => runApprove(approvable.map((i) => i.postId))}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Aprovar todas ({approvable.length})
          </Button>
          {canReserveDirect ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5"
              disabled={busy || pending.length === 0}
              onClick={() =>
                runReserve((selected.length > 0 ? selected : pending.map((i) => i.postId)))
              }
              title="Reserva a data sem esperar o cliente (Owner/Admin)"
            >
              <Lock className="h-3.5 w-3.5" />
              Reservar sem cliente
              {selected.length > 0 ? ` (${selected.length})` : ""}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-background/60 px-4 py-2.5">
        <span className="text-[11px] font-medium text-muted-foreground">Link do cliente</span>
        {absoluteLink ? (
          <>
            <code className="min-w-0 flex-1 truncate rounded border border-border/60 bg-muted/40 px-2 py-1 text-[11px]">
              {absoluteLink}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={() => void copyLink(absoluteLink)}
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar link
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" asChild>
              <a href={absoluteLink} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir
              </a>
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              O cliente confirma as datas no Portal. Gere o link e envie manualmente.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              disabled={busy}
              onClick={() => void loadLink()}
            >
              <Copy className="h-3.5 w-3.5" />
              Gerar link
            </Button>
          </>
        )}
      </div>

      <ul className="divide-y divide-primary/10">
        {pending.map((item) => {
          const canApprove = ["proposed", "client_changes"].includes(item.scheduleStatus);
          const isEditing = editing?.postId === item.postId;
          return (
            <li key={item.postId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Checkbox
                checked={selected.includes(item.postId)}
                disabled={!canApprove}
                onCheckedChange={(v) =>
                  setSelected((cur) =>
                    v ? [...new Set([...cur, item.postId])] : cur.filter((x) => x !== item.postId),
                  )
                }
                aria-label={`Selecionar ${item.title}`}
              />
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[13px] font-medium">{item.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("rounded border px-1.5", PUBLICATION_STATUS.proposed.chip)}>
                    {SCHEDULE_LABEL[item.scheduleStatus] ?? item.scheduleStatus}
                  </span>
                  {item.formats[0] ? <span>{formatLabel(item.formats[0])}</span> : null}
                  {item.channels.length ? <span>· {item.channels.join(", ")}</span> : null}
                  {item.scheduleClientComment ? (
                    <span className="text-amber-600 dark:text-amber-300">
                      · Cliente: {item.scheduleClientComment}
                    </span>
                  ) : null}
                </span>
              </button>

              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="datetime-local"
                    className="h-8 w-[200px] text-xs"
                    value={editing.value}
                    onChange={(e) => setEditing({ postId: item.postId, value: e.target.value })}
                  />
                  <Button size="sm" className="h-8" disabled={busy} onClick={saveSlot}>
                    Salvar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        postId: item.postId,
                        value: toLocalInput(item.proposedAt as string),
                      })
                    }
                    className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] font-medium tabular-nums hover:bg-muted"
                  >
                    {new Date(item.proposedAt as string).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </button>
                  {canApprove ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      disabled={busy}
                      onClick={() => runApprove([item.postId])}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Aprovar
                    </Button>
                  ) : null}
                  {canReserveDirect && item.scheduleStatus !== "reserved" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1"
                      disabled={busy}
                      title="Reservar esta data sem o cliente"
                      onClick={() => runReserve([item.postId])}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Reservar
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    aria-label="Remover proposta de agenda"
                    onClick={() => removeSlot(item.postId)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

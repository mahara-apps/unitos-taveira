import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Send,
  Loader2,
  Paperclip,
  Eye,
  Hourglass,
  CheckCircle2,
  X,
  ClipboardCheck,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BRIEFING_BLOCKS,
  BRIEFING_REVIEW_DECISION_LABEL,
  BRIEFING_FIELDS,
  BRIEFING_REQUEST_STATUS_LABEL,
  briefingFieldLabel,
} from "@/lib/briefing-fields";
import {
  cancelBriefingRequestFn,
  createBriefingRequestFn,
  getBriefingProposalsFn,
  listBriefingRequestsFn,
  markBriefingRequestInReviewFn,
  getBriefingReviewDiffFn,
  decideBriefingReviewFn,
  listBriefingReviewsFn,
} from "@/lib/briefing-requests.functions";

/**
 * FASE 3 — Solicitação de briefing ao cliente (lado agência).
 *
 * A equipe escolhe blocos/campos do briefing canônico; o cliente responde no
 * Portal e a resposta chega aqui como PROPOSTA (o briefing oficial só muda
 * quando promovido — próxima fase).
 */
export function BriefingRequestPanel({ brandId, clientId }: { brandId: string; clientId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listBriefingRequestsFn);
  const create = useServerFn(createBriefingRequestFn);
  const cancel = useServerFn(cancelBriefingRequestFn);
  const review = useServerFn(markBriefingRequestInReviewFn);

  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["briefing-requests", brandId, clientId],
    queryFn: () => list({ data: { brandId, clientId } }),
  });

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["briefing-requests", brandId, clientId] });

  const send = useMutation({
    mutationFn: () =>
      create({
        data: { brandId, clientId, fields: selected, message: message.trim() || undefined },
      }),
    onSuccess: () => {
      toast.success("Solicitação enviada ao cliente");
      setSelected([]);
      setMessage("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao solicitar"),
  });

  const toggle = (key: string) =>
    setSelected((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  const rows = q.data ?? [];

  return (
    <section id="briefing-solicitacoes" className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Solicitar briefing ao cliente</h3>
        <p className="text-xs text-muted-foreground">
          Escolha o que o cliente precisa responder. A resposta chega como proposta, sem alterar o
          briefing oficial.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {BRIEFING_BLOCKS.map((block) => (
            <div key={block.id} className="space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {block.label}
              </div>
              <div className="space-y-1.5">
                {BRIEFING_FIELDS.filter((f) => f.block === block.id).map((f) => (
                  <label key={f.key} className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox
                      checked={selected.includes(f.key)}
                      onCheckedChange={() => toggle(f.key)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Textarea
          rows={2}
          placeholder="Mensagem para o cliente (opcional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted-foreground">
            {selected.length} campo(s) selecionado(s)
          </div>
          <Button
            size="sm"
            disabled={!selected.length || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Solicitar ao cliente
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <div className="border-b border-border/60 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          solicitações
        </div>
        {q.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            Nenhuma solicitação enviada ainda.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {r.requested_fields.map(briefingFieldLabel).join(" · ")}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Solicitado em {new Date(r.requested_at).toLocaleDateString("pt-BR")}
                    {r.submitted_at
                      ? ` · respondido em ${new Date(r.submitted_at).toLocaleDateString("pt-BR")}`
                      : ""}
                    {r.canceled_at ? " · cancelado" : ""}
                    {r.review_decision
                      ? ` · ${BRIEFING_REVIEW_DECISION_LABEL[r.review_decision] ?? r.review_decision}`
                      : ""}
                  </div>
                  {r.pending_fields.length > 0 && r.review_decision ? (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400">
                      Pendente com o cliente: {r.pending_fields.map(briefingFieldLabel).join(", ")}
                    </div>
                  ) : null}
                </div>
                <Badge
                  variant={r.status === "requested" ? "outline" : "secondary"}
                  className="shrink-0 gap-1 text-[10px]"
                >
                  {r.status === "requested" ? (
                    <Hourglass className="h-3 w-3" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  {BRIEFING_REQUEST_STATUS_LABEL[r.status] ?? r.status}
                </Badge>
                {r.proposals > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => setViewing(r.id)}
                  >
                    <Eye className="h-3.5 w-3.5" /> Ver resposta
                  </Button>
                ) : null}
                {r.proposals > 0 && r.status !== "approved" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => setReviewing(r.id)}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" /> Revisar
                  </Button>
                ) : null}
                {r.status === "submitted" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={async () => {
                      await review({ data: { brandId, clientId, requestId: r.id } });
                      invalidate();
                    }}
                  >
                    Marcar em revisão
                  </Button>
                ) : null}
                {r.status === "requested" && !r.canceled_at ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={async () => {
                      await cancel({ data: { requestId: r.id } });
                      invalidate();
                    }}
                  >
                    <X className="h-3.5 w-3.5" /> Cancelar
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <ProposalDialog requestId={viewing} onClose={() => setViewing(null)} />
      <ReviewDialog
        brandId={brandId}
        clientId={clientId}
        requestId={reviewing}
        onClose={() => setReviewing(null)}
        onDone={invalidate}
      />
    </section>
  );
}

function ProposalDialog({ requestId, onClose }: { requestId: string | null; onClose: () => void }) {
  const get = useServerFn(getBriefingProposalsFn);
  const q = useQuery({
    queryKey: ["briefing-proposals", requestId],
    queryFn: () => get({ data: { requestId: requestId! } }),
    enabled: !!requestId,
  });

  return (
    <Dialog open={!!requestId} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Resposta do cliente</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !q.data?.length ? (
          <div className="text-sm text-muted-foreground">Nenhuma resposta registrada.</div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {q.data.map((p) => (
              <div key={p.id} className="space-y-3 rounded-lg border border-border/60 p-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {new Date(p.created_at).toLocaleString("pt-BR")} ·{" "}
                  {p.submitted_via === "portal_token" ? "link do portal" : "portal autenticado"}
                </div>
                {Object.entries(p.payload).map(([key, value]) => (
                  <div key={key} className="space-y-0.5">
                    <div className="text-xs font-medium">{briefingFieldLabel(key)}</div>
                    <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {Array.isArray(value) ? value.join(", ") : String(value)}
                    </div>
                  </div>
                ))}
                {p.note ? (
                  <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                    {p.note}
                  </div>
                ) : null}
                {p.attachments.length > 0 ? (
                  <div className="space-y-1">
                    {p.attachments.map((a) => (
                      <a
                        key={a.path}
                        href={a.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Paperclip className="h-3 w-3" /> {a.name}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * FASE 4 — Revisão e promoção.
 *
 * Comparação campo a campo (briefing atual × proposta). Só os campos marcados
 * são promovidos para `clients.brand_hub`; o restante volta como pendência ao
 * cliente. Toda decisão gera versão + registro no histórico.
 */
function ReviewDialog({
  brandId,
  clientId,
  requestId,
  onClose,
  onDone,
}: {
  brandId: string;
  clientId: string;
  requestId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const getDiff = useServerFn(getBriefingReviewDiffFn);
  const decide = useServerFn(decideBriefingReviewFn);
  const listReviews = useServerFn(listBriefingReviewsFn);

  const [accepted, setAccepted] = useState<string[] | null>(null);
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["briefing-review-diff", requestId],
    queryFn: () => getDiff({ data: { brandId, clientId, requestId: requestId! } }),
    enabled: !!requestId,
  });

  const history = useQuery({
    queryKey: ["briefing-reviews", brandId, clientId, requestId],
    queryFn: () => listReviews({ data: { brandId, clientId, requestId } }),
    enabled: !!requestId,
  });

  const answered = (q.data?.fields ?? []).filter((f) => f.answered);
  const selected = accepted ?? answered.map((f) => f.key);

  const run = useMutation({
    mutationFn: (decision: "approved" | "partial" | "changes_requested") =>
      decide({
        data: {
          brandId,
          clientId,
          requestId: requestId!,
          decision,
          acceptedFields: decision === "partial" ? selected : undefined,
          note: note.trim() || undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        res.decision === "changes_requested"
          ? "Complementação solicitada ao cliente"
          : `Briefing atualizado (${res.promotedFields.length} campo(s))`,
      );
      void qc.invalidateQueries({ queryKey: ["briefing-review-diff", requestId] });
      void qc.invalidateQueries({ queryKey: ["briefing-reviews", brandId, clientId, requestId] });
      void qc.invalidateQueries({ queryKey: ["brand-hub"] });
      setAccepted(null);
      setNote("");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao registrar a decisão"),
  });

  const toggle = (key: string) =>
    setAccepted(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  const allSelected = answered.length > 0 && selected.length === answered.length;

  return (
    <Dialog open={!!requestId} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revisar briefing do cliente</DialogTitle>
        </DialogHeader>

        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !q.data ? (
          <div className="text-sm text-muted-foreground">Não foi possível carregar a revisão.</div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Marque o que deve entrar no briefing oficial. Nada é sobrescrito sem sua confirmação —
              o valor anterior permanece registrado no histórico de versões.
            </p>

            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {q.data.fields.map((f) => (
                <div
                  key={f.key}
                  className="rounded-lg border border-border/60 p-3"
                  data-answered={f.answered ? "1" : "0"}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      className="mt-0.5"
                      disabled={!f.answered}
                      checked={f.answered && selected.includes(f.key)}
                      onCheckedChange={() => toggle(f.key)}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">{briefingFieldLabel(f.key)}</span>
                        {!f.answered ? (
                          <Badge variant="outline" className="text-[10px]">
                            Sem resposta
                          </Badge>
                        ) : f.currentEmpty ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Novo
                          </Badge>
                        ) : f.changed ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Substitui valor atual
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            Igual ao atual
                          </Badge>
                        )}
                      </div>
                      <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr]">
                        <div className="space-y-0.5">
                          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            briefing atual
                          </div>
                          <div className="whitespace-pre-wrap text-xs text-muted-foreground">
                            {formatValue(f.current) || "—"}
                          </div>
                        </div>
                        <ArrowRight className="mt-4 hidden h-3.5 w-3.5 shrink-0 text-muted-foreground md:block" />
                        <div className="space-y-0.5">
                          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            proposta do cliente
                          </div>
                          <div className="whitespace-pre-wrap text-xs">
                            {formatValue(f.proposed) || "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {q.data.proposalNote ? (
              <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                Observação do cliente: {q.data.proposalNote}
              </div>
            ) : null}

            <Textarea
              rows={2}
              placeholder="Observação da decisão / o que ainda falta (opcional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-muted-foreground">
                {selected.length} de {answered.length} campo(s) respondido(s) selecionado(s)
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={run.isPending}
                  onClick={() => run.mutate("changes_requested")}
                >
                  Solicitar complementação
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={run.isPending || !selected.length || allSelected}
                  onClick={() => run.mutate("partial")}
                >
                  Aprovar parcialmente
                </Button>
                <Button
                  size="sm"
                  disabled={run.isPending || !answered.length}
                  onClick={() => run.mutate("approved")}
                >
                  {run.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Aprovar tudo
                </Button>
              </div>
            </div>

            {(history.data?.length ?? 0) > 0 ? (
              <div className="space-y-1 border-t border-border/60 pt-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  histórico de decisões
                </div>
                {history.data!.map((h) => (
                  <div key={h.id} className="text-[11px] text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("pt-BR")} ·{" "}
                    {BRIEFING_REVIEW_DECISION_LABEL[h.decision] ?? h.decision}
                    {h.accepted_fields.length
                      ? ` · promovidos: ${h.accepted_fields.map(briefingFieldLabel).join(", ")}`
                      : ""}
                    {h.pending_fields.length
                      ? ` · pendentes: ${h.pending_fields.map(briefingFieldLabel).join(", ")}`
                      : ""}
                    {h.note ? ` · ${h.note}` : ""}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatValue(v: string | string[] | null): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(", ") : v;
}

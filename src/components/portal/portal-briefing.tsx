import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Hourglass,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { usePortalApi } from "./portal-context";
import { EmptyState, ErrorState, ListSkeleton, formatDate } from "./portal-shared";
import {
  BRIEFING_BLOCKS,
  briefingField,
  briefingFieldLabel,
  type BriefingField,
} from "@/lib/briefing-fields";
import type { PortalBriefingRequest } from "@/lib/portal-briefing.functions";

/**
 * FASE 6 — Briefing do Portal.
 *
 * Fluxo inalterado: `brand_briefing_requests` → `brand_briefing_proposals` →
 * revisão da agência → promoção para `clients.brand_hub`. Esta tela é apenas a
 * camada de apresentação: lê `api.briefingRequests()` e grava com
 * `api.submitBriefing()`. Nada é escrito direto no hub.
 */

/* --------------------------------- status --------------------------------- */

type ClientState = "waiting" | "submitted" | "in_review" | "changes" | "done";

function clientState(r: PortalBriefingRequest): ClientState {
  const needsMore =
    (r.review_decision === "partial" || r.review_decision === "changes_requested") &&
    (r.pending_fields?.length ?? 0) > 0;
  if (needsMore) return "changes";
  if (r.status === "approved") return "done";
  if (r.status === "in_review") return "in_review";
  if (r.status === "submitted") return "submitted";
  return "waiting";
}

const STATE_META: Record<ClientState, { label: string; className: string; icon: typeof FileText }> =
  {
    waiting: {
      label: "Aguardando sua resposta",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      icon: Hourglass,
    },
    submitted: {
      label: "Enviado",
      className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
      icon: CheckCircle2,
    },
    in_review: {
      label: "Em revisão",
      className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
      icon: Clock3,
    },
    changes: {
      label: "Ajustes necessários",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      icon: Hourglass,
    },
    done: {
      label: "Concluído",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      icon: CheckCircle2,
    },
  };

function StateBadge({ state }: { state: ClientState }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`shrink-0 gap-1 text-[11px] ${meta.className}`}>
      <Icon className="h-3 w-3" /> {meta.label}
    </Badge>
  );
}

function dueLabel(due: string | null): { text: string; late: boolean } | null {
  if (!due) return null;
  const ms = new Date(due).getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  if (ms < 0) return { text: `Prazo encerrado em ${formatDate(due)}`, late: true };
  if (days <= 1) return { text: `Responda até hoje (${formatDate(due)})`, late: true };
  return { text: `Responda até ${formatDate(due)} · ${days} dias`, late: false };
}

/* ---------------------------------- tela ---------------------------------- */

export function PortalBriefing() {
  const api = usePortalApi();
  const q = useQuery({
    queryKey: ["portal", "briefing-requests", api.scopeKey],
    queryFn: () => api.briefingRequests(),
  });

  if (q.isLoading) return <ListSkeleton />;
  if (q.isError)
    return (
      <ErrorState
        description="Não conseguimos carregar seus pedidos de briefing agora."
        onRetry={() => q.refetch()}
      />
    );

  const requests = q.data ?? [];
  const open = requests.filter((r) => {
    const s = clientState(r);
    return s === "waiting" || s === "changes";
  });
  const closed = requests.filter((r) => !open.includes(r));

  return (
    <div className="space-y-5">
      {requests.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum briefing pendente"
          description="Quando a equipe precisar de novas informações, o pedido aparece aqui."
        />
      ) : null}

      {open.length === 0 && closed.length > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="font-medium">Nada pendente por aqui.</span>
          <span className="text-muted-foreground">
            Suas respostas estão com a equipe para análise.
          </span>
        </div>
      ) : null}

      {open.map((r) => (
        <RequestForm key={r.id} request={r} />
      ))}

      {closed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            histórico
          </h2>
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
            {closed.map((r) => (
              <HistoryRow key={r.id} request={r} />
            ))}
          </div>
        </section>
      ) : null}

      <LegacyBriefingLinks />
    </div>
  );
}

/* -------------------------------- formulário ------------------------------- */

function RequestForm({ request }: { request: PortalBriefingRequest }) {
  const api = usePortalApi();
  const qc = useQueryClient();
  const state = clientState(request);
  const needsMore = state === "changes";

  /** Após revisão parcial, o cliente só complementa o que ficou pendente. */
  const keys = needsMore ? request.pending_fields : request.requested_fields;
  const fields = useMemo(() => keys.map(briefingField).filter(Boolean) as BriefingField[], [keys]);

  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    const prev = request.answered ?? {};
    for (const f of fields) {
      const v = prev[f.key];
      out[f.key] = Array.isArray(v) ? v.join("\n") : (v ?? "");
    }
    return out;
  }, [fields, request.answered]);

  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<
    Array<{ name: string; mime?: string | null; dataBase64: string }>
  >([]);

  const filledCount = fields.filter((f) => (answers[f.key] ?? "").trim().length > 0).length;
  const pct = fields.length ? Math.round((filledCount / fields.length) * 100) : 0;
  const due = dueLabel(request.due_at);

  const blocks = BRIEFING_BLOCKS.map((b) => ({
    ...b,
    fields: fields.filter((f) => f.block === b.id),
  })).filter((b) => b.fields.length > 0);

  const submit = useMutation({
    mutationFn: () =>
      api.submitBriefing({
        requestId: request.id,
        answers: Object.fromEntries(
          fields.map((f) => [
            f.key,
            f.type === "list"
              ? (answers[f.key] ?? "")
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean)
              : (answers[f.key] ?? ""),
          ]),
        ),
        note: note.trim() || undefined,
        attachments: files.length ? files : undefined,
      }),
    onSuccess: () => {
      toast.success("Resposta enviada. A equipe vai analisar.");
      setFiles([]);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["portal", "briefing-requests"] });
      void qc.invalidateQueries({ queryKey: ["portal", "metrics"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível enviar"),
  });

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    const next: typeof files = [];
    for (const file of Array.from(list).slice(0, 5)) {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
      next.push({ name: file.name, mime: file.type || null, dataBase64: btoa(bin) });
    }
    setFiles(next);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      {/* cabeçalho: pedido, status, prazo e progresso real */}
      <header className="space-y-3 border-b border-border/60 bg-muted/30 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-semibold sm:text-base">
              {needsMore
                ? "A equipe precisa de um complemento"
                : "A equipe pediu algumas informações"}
            </div>
            <p className="text-xs text-muted-foreground">
              Solicitado em {formatDate(request.requested_at)} · {fields.length}{" "}
              {fields.length === 1 ? "pergunta" : "perguntas"}
            </p>
          </div>
          <StateBadge state={state} />
        </div>

        {request.message ? (
          <p className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground">
            “{request.message}”
          </p>
        ) : null}

        {needsMore && request.review_note ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            <span className="font-medium">O que precisa ser complementado: </span>
            {request.review_note}
          </p>
        ) : null}

        {needsMore ? (
          <p className="text-xs text-muted-foreground">
            Pendente: {request.pending_fields.map(briefingFieldLabel).join(" · ")}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {filledCount} de {fields.length} respondidas
            </span>
            <span className="font-medium">{pct}%</span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>

        {due ? (
          <div
            className={`inline-flex items-center gap-1.5 text-xs ${
              due.late ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
            }`}
          >
            <Clock3 className="h-3.5 w-3.5" /> {due.text}
          </div>
        ) : null}
      </header>

      {/* blocos de perguntas */}
      <div className="divide-y divide-border/60">
        {blocks.map((block) => (
          <div key={block.id} className="space-y-4 px-4 py-4 sm:px-5">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {block.label}
            </h3>
            <div className="grid gap-4">
              {block.fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor={`${request.id}-${f.key}`}>
                    {f.label}
                  </label>
                  {f.hint ? <p className="text-[11px] text-muted-foreground">{f.hint}</p> : null}
                  {f.type === "text" ? (
                    <Input
                      id={`${request.id}-${f.key}`}
                      value={answers[f.key] ?? ""}
                      onChange={(e) => setAnswers((p) => ({ ...p, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <Textarea
                      id={`${request.id}-${f.key}`}
                      rows={f.type === "list" ? 3 : 4}
                      value={answers[f.key] ?? ""}
                      onChange={(e) => setAnswers((p) => ({ ...p, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Quer complementar algo? (opcional)</div>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Paperclip className="h-3.5 w-3.5" /> Referências e documentos (opcional)
            </div>
            <Input type="file" multiple onChange={(e) => void pickFiles(e.target.files)} />
            {files.length ? (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remover ${f.name}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setFiles((p) => p.filter((x) => x.name !== f.name))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Até 5 arquivos. Imagens, PDFs ou documentos de referência.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ação */}
      <footer className="flex flex-col gap-3 border-t border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-[11px] text-muted-foreground">
          Sua resposta vai para análise da equipe antes de entrar no briefing da marca.
        </p>
        <Button
          className="w-full sm:w-auto"
          disabled={filledCount === 0 || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Enviar resposta
        </Button>
      </footer>
    </section>
  );
}

/* --------------------------------- histórico ------------------------------- */

function HistoryRow({ request }: { request: PortalBriefingRequest }) {
  const [open, setOpen] = useState(false);
  const state = clientState(request);
  const answered = request.answered ?? {};
  const entries = Object.entries(answered);

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="truncate text-sm font-medium">
            {request.requested_fields.map(briefingFieldLabel).join(" · ") || "Briefing"}
          </div>
          <div className="text-xs text-muted-foreground">
            {request.submitted_at ? `Enviado em ${formatDate(request.submitted_at)}` : "—"}
            {request.decided_at ? ` · analisado em ${formatDate(request.decided_at)}` : ""}
          </div>
          {state === "submitted" || state === "in_review" ? (
            <div className="text-xs text-muted-foreground">Aguardando análise da equipe.</div>
          ) : null}
          {request.review_note ? (
            <div className="text-xs text-muted-foreground">
              Retorno da equipe: {request.review_note}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StateBadge state={state} />
          {entries.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
              {open ? "Ocultar" : "Ver respostas"}
            </Button>
          ) : null}
        </div>
      </div>

      {open && entries.length > 0 ? (
        <dl className="mt-3 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
          {entries.map(([key, value]) => (
            <div key={key} className="space-y-0.5">
              <dt className="text-[11px] font-medium text-muted-foreground">
                {briefingFieldLabel(key)}
              </dt>
              <dd className="whitespace-pre-line text-sm">
                {Array.isArray(value) ? value.join(", ") : value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/* ------------------------------ links legados ------------------------------ */

/** Links de briefing por token (fluxo legado) — mantidos apenas como acesso/histórico. */
function LegacyBriefingLinks() {
  const api = usePortalApi();
  const q = useQuery({
    queryKey: ["portal", "briefings", api.scopeKey],
    queryFn: () => api.briefings(),
  });

  const rows = q.data ?? [];
  const isOpen = (b: (typeof rows)[number]) =>
    !b.revoked_at &&
    !b.submitted_at &&
    (!b.expires_at || new Date(b.expires_at).getTime() > Date.now());
  const pending = rows.filter(isOpen);

  if (!pending.length) return null;

  return (
    <section className="space-y-2">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        formulário enviado por link
      </h2>
      <div className="space-y-2">
        {pending.map((b) => (
          <div
            key={b.id}
            className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="truncate text-sm font-medium">{b.label ?? "Briefing da marca"}</div>
              <div className="text-xs text-muted-foreground">
                {b.expires_at
                  ? `Responda até ${formatDate(b.expires_at)}.`
                  : "Suas respostas alimentam a estratégia do mês."}
              </div>
            </div>
            <a
              href={`/p/briefing/${b.token}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0"
            >
              <Button size="sm" variant="outline" className="gap-1.5">
                Abrir formulário <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

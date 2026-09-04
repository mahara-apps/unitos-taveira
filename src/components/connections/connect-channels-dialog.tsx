import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CONNECTABLE_CHANNELS, UPCOMING_CHANNELS } from "@/components/connections/channel-meta";
import { metaIssueState } from "@/lib/meta/issue-messages";
import {
  authChecklist,
  authProgress,
  connectErrorCopy,
  connectStepIndex,
  isConnectBusy,
  type ChecklistItem,
  type MetaConnectChannel,
  type MetaConnectState,
} from "@/lib/meta/connect-flow";
import type { DiscoveredAccountsResult } from "@/lib/meta/discovery.functions";
import { MetaAssetsPanel } from "@/components/connections/meta-portfolio-dialog";

/**
 * Modal "Conectar canais" — CAMADA DE APRESENTAÇÃO.
 *
 * Nenhuma lógica de OAuth, Meta API, permissões, RLS ou banco vive aqui. O
 * componente recebe o ESTADO REAL do fluxo (`MetaConnectState`) e o resultado
 * da descoberta, e apenas os traduz em stepper, checklist, resumo e erros
 * legíveis. Toda ação é delegada ao chamador.
 *
 * Regras de UX aplicadas:
 * - autorização e sincronização são etapas SEPARADAS;
 * - nenhum estado assíncrono sem destino terminal (sucesso ou erro com retry);
 * - limite temporário da Meta é ATENÇÃO, não falha fatal;
 * - dados parcialmente carregados nunca são substituídos por tela vazia.
 */

const STEPS = ["Autorização", "Ativos", "Validação", "Confirmação"] as const;

function StepBar({ active, failed }: { active: number; failed: boolean }) {
  return (
    <ol className="flex items-stretch gap-2 sm:gap-3">
      {STEPS.map((label, i) => {
        const done = i < active;
        const current = i === active;
        const isError = failed && current;
        return (
          <li key={label} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold transition-colors",
                  done && "bg-emerald-500 text-white",
                  isError && "bg-destructive text-destructive-foreground",
                  current && !isError && "bg-primary text-primary-foreground",
                  !done && !current && "bg-muted text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="h-3 w-3" />
                ) : isError ? (
                  <X className="h-3 w-3" />
                ) : (
                  String(i + 1).padStart(2, "0")
                )}
              </span>
              <span
                className={cn(
                  "truncate text-[11px] transition-colors",
                  current
                    ? isError
                      ? "font-medium text-destructive"
                      : "font-medium text-foreground"
                    : done
                      ? "text-muted-foreground"
                      : "text-muted-foreground/70",
                )}
              >
                {label}
              </span>
            </span>
            <span
              className={cn(
                "h-0.5 w-full rounded-full transition-colors",
                done
                  ? "bg-emerald-500/70"
                  : isError
                    ? "bg-destructive"
                    : current
                      ? "bg-primary"
                      : "bg-border",
              )}
            />
          </li>
        );
      })}
    </ol>
  );
}

function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.label}
          className={cn(
            "flex items-center gap-2 text-xs transition-colors",
            item.state === "current"
              ? "font-medium text-foreground"
              : item.state === "error"
                ? "font-medium text-destructive"
                : item.state === "warning"
                  ? "font-medium text-amber-600"
                  : item.state === "done"
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50",
          )}
        >
          {item.state === "done" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          ) : item.state === "current" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          ) : item.state === "error" ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          ) : item.state === "warning" ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function SummaryGrid({ items }: { items: Array<[label: string, value: number | string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold leading-tight tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function HowItWorks() {
  const items = [
    "Você autoriza o acesso na plataforma oficial da Meta.",
    "O Unitos identifica seus portfólios e ativos.",
    "Você escolhe quais contas deseja vincular.",
    "O canal fica disponível para o cliente.",
  ];
  return (
    <div className="rounded-xl bg-muted/40 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Como funciona
      </p>
      <ol className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        {items.map((text, i) => (
          <li key={text} className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-background text-[9px] font-semibold text-foreground">
              {i + 1}
            </span>
            <span className="leading-snug">{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ConnectChannelsDialog({
  open,
  onOpenChange,
  state,
  onConnect,
  onCancel,
  onContinue,
  onRefreshDiscovery,
  discovery,
  syncing = false,
  assetsStep = false,
  brandId,
  clientId,
  assetsSessionId = null,
  assetsChannel = null,
  onBackFromAssets,
  onFinishAssets,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Estado real do fluxo de autorização (nunca derivado de timers). */
  state: MetaConnectState;
  onConnect: (channel: MetaConnectChannel) => void;
  /** Aborta o acompanhamento da autorização em andamento. */
  onCancel: () => void;
  /** Avança para a seleção de ativos (etapa 02). */
  onContinue: () => void;
  /** Refaz a sincronização de portfólios/ativos (usado em limite temporário). */
  onRefreshDiscovery: () => void;
  discovery?: DiscoveredAccountsResult;
  /** true enquanto a descoberta de ativos está em andamento. */
  syncing?: boolean;
  /** Etapa 02 "Ativos" acontece DENTRO deste mesmo modal. */
  assetsStep?: boolean;
  brandId?: string;
  clientId?: string;
  assetsSessionId?: string | null;
  assetsChannel?: "facebook" | "instagram" | "threads" | "ads" | null;
  onBackFromAssets?: () => void;
  onFinishAssets?: () => void;
}) {
  const busy = isConnectBusy(state);
  const busyChannelKey = busy ? (state as { channel: MetaConnectChannel }).channel : null;

  const summary = useMemo(() => {
    if (!discovery || discovery.needsAuthorization) return null;
    const accounts = discovery.accounts ?? [];
    return {
      portfolios: discovery.businesses?.length ?? 0,
      pages: accounts.filter((a) => a.channel === "facebook").length,
      instagram: accounts.filter((a) => a.channel === "instagram").length,
      total: accounts.length,
    };
  }, [discovery]);

  const issue = useMemo(
    () => metaIssueState([discovery?.error, ...(discovery?.warnings ?? [])]),
    [discovery],
  );

  const syncItems: ChecklistItem[] = useMemo(() => {
    const hasData = !!summary && summary.total > 0;
    const blocked = !!issue && !hasData;
    return [
      { label: "Autorização concluída", state: "done" },
      { label: "Conta Meta identificada", state: discovery?.metaUserId ? "done" : "current" },
      {
        label: "Buscando portfólios",
        state:
          (summary?.portfolios ?? 0) > 0
            ? "done"
            : blocked
              ? "error"
              : syncing
                ? "current"
                : "done",
      },
      {
        label: "Carregando páginas e Instagram",
        state: hasData ? "done" : blocked ? "error" : syncing ? "current" : "done",
      },
      {
        label: hasData && issue ? "Permissões validadas parcialmente" : "Validando permissões",
        // Com ativos já carregados, uma limitação da Meta é atenção — nunca erro fatal.
        state: issue
          ? hasData
            ? "warning"
            : "error"
          : syncing
            ? "pending"
            : hasData
              ? "done"
              : "pending",
      },
    ];
  }, [discovery?.metaUserId, issue, summary, syncing]);

  const errorCopy = state.kind === "error" ? connectErrorCopy(state.reason) : null;

  const inAssets = assetsStep && !!assetsSessionId && !!brandId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden p-0",
          inAssets ? "sm:max-w-[900px]" : "sm:max-w-[720px]",
        )}
      >
        <DialogHeader className="space-y-1 px-6 pb-4 pt-6 text-left">
          <DialogTitle className="text-[17px] font-semibold tracking-tight">
            Conectar canais
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-snug text-muted-foreground">
            A autorização acontece na tela oficial do provedor. Depois você escolhe quais ativos
            vincular a cada cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-5">
          <StepBar
            active={inAssets ? 1 : connectStepIndex(state)}
            failed={!inAssets && state.kind === "error"}
          />
        </div>

        {inAssets ? (
          <>
            <div className="max-h-[68vh] overflow-y-auto border-t px-6 py-5">
              <MetaAssetsPanel
                brandId={brandId!}
                clientId={clientId}
                sessionId={assetsSessionId}
                active={open}
                channel={assetsChannel}
                assign
                onClose={() => onFinishAssets?.()}
              />
            </div>
            <div className="flex items-center gap-2 border-t bg-muted/20 px-6 py-3.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
                Ativar deixa a conta disponível no workspace; vincular ao cliente é o passo
                seguinte.
              </p>
              {onBackFromAssets ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={onBackFromAssets}
                >
                  Voltar
                </Button>
              ) : null}
            </div>
          </>
        ) : (

        <div className="max-h-[62vh] space-y-5 overflow-y-auto border-t px-6 py-5">
          {/* --------------------------- erro terminal do fluxo -------------------------- */}
          {errorCopy ? (
            <section
              className={cn(
                "rounded-xl p-4",
                errorCopy.severity === "critical" ? "bg-destructive/10" : "bg-amber-500/10",
              )}
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    errorCopy.severity === "critical" ? "text-destructive" : "text-amber-600",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{errorCopy.title}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {errorCopy.summary}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {errorCopy.action !== "close" ? (
                      <Button
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          onConnect((state.kind === "error" && state.channel) || "facebook")
                        }
                      >
                        <RefreshCw className="mr-1.5 h-3 w-3" />
                        {errorCopy.actionLabel}
                      </Button>
                    ) : null}
                    {state.kind === "error" && state.detail ? (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                          >
                            Ver detalhes
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="mt-2 break-words font-mono text-[10px] text-muted-foreground/80">
                            {state.detail}
                          </p>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {/* ------------------------- autorização em andamento ------------------------- */}
          {busy ? (
            <section className="space-y-4 rounded-xl border bg-card p-4">
              <div className="flex items-start gap-2.5">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Autorização em andamento</p>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Conclua o consentimento na janela oficial da Meta. Você pode manter esta tela
                    aberta — avisaremos aqui quando a autorização retornar.
                  </p>
                </div>
              </div>

              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${authProgress(state)}%` }}
                />
              </div>

              <Checklist items={authChecklist(state)} />

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground"
                onClick={onCancel}
              >
                Cancelar acompanhamento
              </Button>
            </section>
          ) : null}

          {/* ------------------------- autorização concluída -------------------------- */}
          {state.kind === "authorized" ? (
            <>
              <section className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <p className="text-sm font-medium">Conexão autorizada</p>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  Sua conta foi autorizada. Estamos carregando os ativos disponíveis — algumas
                  informações podem aparecer alguns segundos depois.
                </p>
                <div className="mt-3">
                  <SummaryGrid
                    items={[
                      ["Portfólios", summary?.portfolios ?? "—"],
                      ["Páginas", summary?.pages ?? "—"],
                      ["Instagram", summary?.instagram ?? "—"],
                      ["Ativos", summary?.total ?? "—"],
                    ]}
                  />
                </div>
              </section>

              <section className="rounded-xl bg-muted/40 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {syncing ? "Sincronizando ativos" : "Sincronização"}
                </p>
                <div className="mt-2.5">
                  <Checklist items={syncItems} />
                </div>
              </section>

              {issue ? (
                <Collapsible>
                  <section
                    className={cn(
                      "rounded-xl p-4",
                      issue.severity === "critical" ? "bg-destructive/10" : "bg-amber-500/10",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {issue.kind === "rate_limit"
                            ? "Sincronização temporariamente limitada"
                            : "Alguns ativos não puderam ser carregados"}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {issue.kind === "rate_limit"
                            ? "A Meta atingiu o limite de consultas neste momento. Não é necessário autorizar novamente: os dados já carregados continuam válidos. Siga com os ativos disponíveis ou tente sincronizar em alguns minutos."
                            : "A Meta não liberou parte dos ativos deste portfólio. Os ativos já listados podem ser usados normalmente; se faltar alguma conta, refaça a autorização marcando as Páginas e contas desejadas."}

                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={onRefreshDiscovery}
                            disabled={syncing}
                          >
                            {syncing ? (
                              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-1.5 h-3 w-3" />
                            )}
                            Tentar novamente
                          </Button>
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                            >
                              Ver detalhes
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </CollapsibleTrigger>
                        </div>
                        <CollapsibleContent>
                          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                            {issue.recommendation}
                          </p>
                          {discovery?.error ? (
                            <p className="mt-1.5 break-words font-mono text-[10px] text-muted-foreground/80">
                              {discovery.error}
                            </p>
                          ) : null}
                          {(discovery?.warnings ?? []).slice(0, 4).map((w) => (
                            <p
                              key={w}
                              className="mt-1 break-words font-mono text-[10px] text-muted-foreground/80"
                            >
                              {w}
                            </p>
                          ))}
                        </CollapsibleContent>
                      </div>
                    </div>
                  </section>
                </Collapsible>
              ) : null}
            </>
          ) : null}

          {/* --------------------------- estado inicial / retry -------------------------- */}
          {!busy && state.kind !== "authorized" ? (
            <>
              <section className="space-y-2.5">
                <div>
                  <h3 className="text-sm font-semibold">Conectar com a Meta</h3>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Autorize o Unitos a acessar suas contas profissionais. Você será direcionado
                    para a plataforma oficial da Meta.
                  </p>
                </div>
                <div className="space-y-2">
                  {CONNECTABLE_CHANNELS.map((def) => {
                    const Icon = def.icon;
                    const key = def.key as MetaConnectChannel;
                    return (
                      <button
                        key={def.key}
                        type="button"
                        onClick={() => onConnect(key)}
                        disabled={!!busyChannelKey}
                        className="group flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border bg-card p-4 text-left transition-all duration-150 hover:border-primary/40 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span
                          className={cn(
                            "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
                            key === "instagram" ? "bg-pink-500/10" : "bg-sky-500/10",
                          )}
                        >
                          <Icon className={cn("h-5 w-5", def.tone)} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{def.label}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {def.hint ?? "Meta · autorização oficial"}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            def.recommended
                              ? "bg-primary/10 text-primary"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {def.recommended ? "Recomendado" : "Disponível"}
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-2.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Em breve
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {UPCOMING_CHANNELS.map((def) => {
                    const Icon = def.icon;
                    return (
                      <div
                        key={def.key}
                        aria-disabled
                        className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2.5 opacity-70"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                          {def.label}
                        </span>
                        <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Em breve
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <HowItWorks />
            </>
          ) : null}
        </div>
        )}

        {!inAssets ? (
          <div className="flex items-center gap-2 border-t bg-muted/20 px-6 py-3.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
              Você será redirecionado para a plataforma oficial da Meta. O Unitos não solicita sua
              senha.
            </p>
            {state.kind === "authorized" ? (
              <Button size="sm" className="h-8 shrink-0 text-xs" onClick={onContinue}>
                {summary && summary.total > 0
                  ? `Selecionar ativos · ${summary.total}`
                  : "Continuar com dados disponíveis"}

                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 text-xs"
                onClick={() => onOpenChange(false)}
              >
                Fechar
              </Button>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

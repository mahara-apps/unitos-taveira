/**
 * Estado operacional da INSTALAÇÃO (puro, compartilhado UI + servidor).
 *
 * - `active`: ambiente normal.
 * - `maintenance`: atualização em andamento — leitura liberada, gravação
 *   temporariamente bloqueada (faixa fixa no topo).
 * - `suspended`: acesso bloqueado para todos, exceto Super Admin.
 *
 * `until` é rede de segurança: se a operação for interrompida, o estado
 * expira sozinho e o ambiente nunca fica travado para sempre.
 */

export const SERVICE_STATES = ["active", "maintenance", "suspended"] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

export const isServiceState = (v: unknown): v is ServiceState =>
  typeof v === "string" && (SERVICE_STATES as readonly string[]).includes(v);

export type ServiceStateInfo = {
  state: ServiceState;
  message: string | null;
  until: string | null;
};

export const ACTIVE_SERVICE_STATE: ServiceStateInfo = {
  state: "active",
  message: null,
  until: null,
};

export type ServiceGate = {
  state: ServiceState;
  /** true quando ninguém (exceto Super Admin) deve navegar. */
  blocked: boolean;
  /** true quando criar/salvar deve ficar indisponível. */
  writesBlocked: boolean;
  title: string;
  message: string;
};

const DEFAULT_MESSAGE: Record<ServiceState, string> = {
  active: "",
  maintenance: "Atualização em andamento — evite salvar agora.",
  suspended: "Este ambiente está temporariamente suspenso.",
};

const TITLE: Record<ServiceState, string> = {
  active: "",
  maintenance: "Atualização em andamento",
  suspended: "Sistema suspenso",
};

/** Resolve o estado efetivo, já considerando expiração por tempo. */
export function resolveServiceGate(
  info: Partial<ServiceStateInfo> | null | undefined,
  now: number = Date.now(),
): ServiceGate {
  const raw = isServiceState(info?.state) ? info!.state : "active";
  const untilMs = info?.until ? Date.parse(info.until) : Number.NaN;
  const expired = Number.isFinite(untilMs) && untilMs <= now;
  const state: ServiceState = raw === "active" || expired ? "active" : raw;

  const message = (info?.message ?? "").trim() || DEFAULT_MESSAGE[state];
  return {
    state,
    blocked: state === "suspended",
    writesBlocked: state !== "active",
    title: TITLE[state],
    message,
  };
}

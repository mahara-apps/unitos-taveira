/**
 * Máquina de estados do fluxo "Conectar canais" (Meta).
 *
 * Camada PURA: nenhuma chamada de OAuth, Graph API, banco ou server function
 * vive aqui. O objetivo é impedir que o modal fique preso em loading — todo
 * estado assíncrono tem um destino terminal (autorizado ou erro classificado)
 * e cada item de checklist reflete um RESULTADO real, não uma função chamada.
 */

import { classifyMetaIssue } from "./issue-messages";

export type MetaConnectChannel = "facebook" | "instagram";

export type MetaConnectErrorKind =
  | "start_failed" // a server function falhou (rede, RBAC, exceção)
  | "invalid_response" // retorno indefinido/incompleto
  | "missing_url" // retorno sem `authorizeUrl` utilizável
  | "popup_blocked" // navegador bloqueou a janela de consentimento
  | "cancelled" // usuário fechou a janela sem concluir
  | "denied" // Meta recusou / permissões não concedidas
  | "timeout" // consentimento não retornou em tempo hábil
  | "rate_limit" // (#4) e afins durante o retorno
  | "permission" // escopos insuficientes no retorno
  | "unknown";

export type MetaConnectState =
  | { kind: "idle" }
  /** `startMetaOAuth` em execução — nada foi confirmado ainda. */
  | { kind: "starting"; channel: MetaConnectChannel }
  /** URL real aberta na janela oficial; aguardando consentimento do usuário. */
  | { kind: "awaiting"; channel: MetaConnectChannel }
  /** Retorno recebido; validando sessão criada pelo callback. */
  | { kind: "returning"; channel: MetaConnectChannel }
  /** Autorização concluída (sessão válida). Sincronização é etapa separada. */
  | { kind: "authorized"; channel: MetaConnectChannel; sessionId: string }
  | {
      kind: "error";
      channel: MetaConnectChannel | null;
      reason: MetaConnectErrorKind;
      /** Texto técnico da Meta/servidor — só aparece em "Ver detalhes". */
      detail?: string | null;
    };

/** true enquanto existe uma operação de autorização em andamento. */
export function isConnectBusy(state: MetaConnectState): boolean {
  return state.kind === "starting" || state.kind === "awaiting" || state.kind === "returning";
}

/** Canal em conexão (compatível com os controles que só precisam disso). */
export function busyChannel(state: MetaConnectState): MetaConnectChannel | null {
  return isConnectBusy(state) ? (state as { channel: MetaConnectChannel }).channel : null;
}

/** Etapa do stepper (0 Autorização · 1 Ativos · 2 Validação · 3 Confirmação). */
export function connectStepIndex(state: MetaConnectState): number {
  return state.kind === "authorized" ? 1 : 0;
}

export type ChecklistItemState = "done" | "current" | "pending" | "error" | "warning";

export type ChecklistItem = { label: string; state: ChecklistItemState };

const AUTH_STEPS = [
  "Preparando autorização",
  "Conectando à Meta",
  "Aguardando autorização",
  "Recebendo retorno da Meta",
  "Validando sessão",
] as const;

/**
 * Progresso real da autorização. O índice avança apenas quando o passo anterior
 * teve resultado confirmado (URL válida recebida, janela navegada, retorno do
 * callback, sessão válida).
 */
export function authChecklist(state: MetaConnectState): ChecklistItem[] {
  const doneCount =
    state.kind === "starting"
      ? 0
      : state.kind === "awaiting"
        ? 2
        : state.kind === "returning"
          ? 3
          : state.kind === "authorized"
            ? AUTH_STEPS.length
            : 0;
  const failedAt =
    state.kind === "error"
      ? state.reason === "start_failed" ||
        state.reason === "invalid_response" ||
        state.reason === "missing_url"
        ? 0
        : state.reason === "popup_blocked"
          ? 1
          : state.reason === "cancelled" || state.reason === "timeout"
            ? 2
            : 3
      : -1;

  return AUTH_STEPS.map((label, i) => {
    if (failedAt >= 0) {
      if (i < failedAt) return { label, state: "done" as const };
      if (i === failedAt) return { label, state: "error" as const };
      return { label, state: "pending" as const };
    }
    if (i < doneCount) return { label, state: "done" as const };
    if (i === doneCount) return { label, state: "current" as const };
    return { label, state: "pending" as const };
  });
}

/** Percentual real de progresso da autorização (0–100). */
export function authProgress(state: MetaConnectState): number {
  const items = authChecklist(state);
  const done = items.filter((i) => i.state === "done").length;
  return Math.round((done / items.length) * 100);
}

export type ConnectErrorCopy = {
  title: string;
  summary: string;
  action: "retry" | "reauthorize" | "close";
  actionLabel: string;
  /** Rate limit é ATENÇÃO, nunca falha fatal da conexão. */
  severity: "warning" | "critical";
};

const ERROR_COPY: Record<MetaConnectErrorKind, ConnectErrorCopy> = {
  start_failed: {
    title: "Não foi possível iniciar a autorização",
    summary:
      "O Unitos não conseguiu preparar a autorização da Meta. Isso normalmente é temporário ou uma questão de permissão do seu usuário no workspace.",
    action: "retry",
    actionLabel: "Tentar novamente",
    severity: "critical",
  },
  invalid_response: {
    title: "Resposta inesperada ao iniciar a autorização",
    summary:
      "A preparação da autorização retornou um resultado incompleto. Nada foi alterado — tente novamente.",
    action: "retry",
    actionLabel: "Tentar novamente",
    severity: "critical",
  },
  missing_url: {
    title: "Endereço de autorização não recebido",
    summary:
      "A Meta não devolveu o endereço de consentimento desta vez. Nenhuma conexão foi criada. Tente novamente em instantes.",
    action: "retry",
    actionLabel: "Tentar novamente",
    severity: "critical",
  },
  popup_blocked: {
    title: "A janela de autorização foi bloqueada",
    summary:
      "Seu navegador impediu a abertura da janela oficial da Meta. Libere pop-ups para este endereço e tente de novo.",
    action: "retry",
    actionLabel: "Tentar novamente",
    severity: "warning",
  },
  cancelled: {
    title: "Autorização cancelada",
    summary:
      "A janela da Meta foi fechada antes da conclusão do consentimento. Nenhuma conta foi conectada.",
    action: "retry",
    actionLabel: "Autorizar novamente",
    severity: "warning",
  },
  denied: {
    title: "A Meta não concluiu a autorização",
    summary:
      "O consentimento foi recusado ou interrompido pela Meta. Refaça a autorização mantendo as Páginas e contas do Instagram marcadas.",
    action: "reauthorize",
    actionLabel: "Autorizar novamente",
    severity: "critical",
  },
  timeout: {
    title: "A autorização demorou demais",
    summary:
      "Não recebemos o retorno da Meta. Se você concluiu o consentimento, tente novamente — a autorização anterior pode já estar válida.",
    action: "retry",
    actionLabel: "Tentar novamente",
    severity: "warning",
  },
  rate_limit: {
    title: "Meta temporariamente limitando consultas",
    summary:
      "A Meta atingiu o limite de requisições agora. Isso não invalida sua autorização: aguarde alguns minutos e tente novamente.",
    action: "retry",
    actionLabel: "Tentar novamente",
    severity: "warning",
  },
  permission: {
    title: "Permissões insuficientes",
    summary:
      "A autorização foi concluída sem todas as permissões necessárias. Refaça o consentimento marcando todas as Páginas e contas do Instagram.",
    action: "reauthorize",
    actionLabel: "Autorizar novamente",
    severity: "critical",
  },
  unknown: {
    title: "Não foi possível concluir a autorização",
    summary: "Algo impediu a conclusão do consentimento. Nenhuma conexão foi criada.",
    action: "retry",
    actionLabel: "Tentar novamente",
    severity: "critical",
  },
};

export function connectErrorCopy(reason: MetaConnectErrorKind): ConnectErrorCopy {
  return ERROR_COPY[reason] ?? ERROR_COPY.unknown;
}

/** Classifica o erro devolvido pelo callback/servidor em um estado terminal. */
export function classifyConnectFailure(raw: unknown): MetaConnectErrorKind {
  const msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const lower = msg.toLowerCase();
  if (!msg) return "unknown";
  if (/access_denied|cancel|cancelad|recus|denied|declin/.test(lower)) return "denied";
  const kind = classifyMetaIssue(msg);
  if (kind === "rate_limit") return "rate_limit";
  if (kind === "permission") return "permission";
  return "unknown";
}

/**
 * Lê `authorizeUrl` do retorno de `startMetaOAuth` sem desestruturar às cegas.
 * Lança erro legível quando o retorno é indefinido ou incompleto — nunca
 * "Cannot destructure property 'authorizeUrl' of undefined".
 */
export function readAuthorizeUrl(res: unknown): string {
  if (!res || typeof res !== "object") {
    throw new Error("A Meta não devolveu os dados de autorização. Tente novamente.");
  }
  const raw = (res as { authorizeUrl?: unknown }).authorizeUrl;
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url) {
    throw new Error("A Meta não devolveu o endereço de autorização. Tente novamente.");
  }
  return url;
}

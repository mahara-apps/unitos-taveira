/**
 * Tradução de falhas da Meta em ESTADOS OPERACIONAIS (camada de apresentação).
 *
 * Regra: a área principal da UI nunca mostra texto cru da Graph API
 * ("Unsupported get request", "Application request limit reached", "(#4)",
 * endpoints, IDs técnicos ou stack trace). O texto técnico só pode aparecer em
 * uma subseção secundária de diagnóstico ("Detalhes técnicos").
 *
 * Não há lógica de OAuth, rede ou banco aqui — apenas classificação de texto.
 */

export type MetaIssueKind = "rate_limit" | "permission" | "generic";

export type MetaIssueState = {
  kind: MetaIssueKind;
  title: string;
  summary: string;
  /** Ação recomendada exibida no detalhe legível. */
  recommendation: string;
  /** true somente quando a causa real é permissão/autorização. */
  suggestReauthorize: boolean;
  /** true quando faz sentido oferecer "Tentar novamente". */
  allowRetry: boolean;
  /** Severidade visual (mesma linguagem de status da tabela de clientes). */
  severity: "warning" | "critical";
};

const RATE_LIMIT_PATTERNS = [
  /\(#4\)/,
  /\(#17\)/,
  /\(#32\)/,
  /\(#341\)/,
  /\(#613\)/,
  /request limit reached/i,
  /rate limit/i,
  /too many calls/i,
  /please retry your request later/i,
  /user request limit/i,
  /limite temporário/i,
  /limite de requisições/i,
];

const PERMISSION_PATTERNS = [
  /\(#10\)/,
  /\(#190\)/,
  /\(#200\)/,
  /\(#102\)/,
  /oauth/i,
  /access token/i,
  /permission/i,
  /permissão/i,
  /not authorized/i,
  /does not have/i,
  /restrict/i,
  /restring/i,
  /unsupported get request/i,
  /cannot be loaded/i,
];

export function classifyMetaIssue(raw: string | null | undefined): MetaIssueKind {
  const msg = (raw ?? "").trim();
  if (!msg) return "generic";
  if (RATE_LIMIT_PATTERNS.some((re) => re.test(msg))) return "rate_limit";
  if (PERMISSION_PATTERNS.some((re) => re.test(msg))) return "permission";
  return "generic";
}

/** Escolhe o estado dominante de um conjunto de mensagens (erro + warnings). */
export function metaIssueState(messages: (string | null | undefined)[]): MetaIssueState | null {
  const list = messages.map((m) => (m ?? "").trim()).filter(Boolean);
  if (!list.length) return null;
  const kinds = list.map(classifyMetaIssue);
  const kind: MetaIssueKind = kinds.includes("rate_limit")
    ? "rate_limit"
    : kinds.includes("permission")
      ? "permission"
      : "generic";
  return ISSUE_STATE[kind];
}

const ISSUE_STATE: Record<MetaIssueKind, MetaIssueState> = {
  rate_limit: {
    kind: "rate_limit",
    title: "Sincronização temporariamente limitada",
    summary:
      "A Meta atingiu o limite de consultas neste momento. Os dados já carregados continuam disponíveis. Tente novamente em alguns minutos.",
    recommendation:
      "Aguarde alguns minutos e sincronize novamente. Não é necessário reautorizar nada na Meta.",
    suggestReauthorize: false,
    allowRetry: true,
    severity: "warning",
  },
  permission: {
    kind: "permission",
    title: "Algumas contas precisam de atenção",
    summary: "Algumas contas da Meta estão com acesso restrito ou indisponível.",
    recommendation:
      "Reautorize a conta na Meta mantendo todas as Páginas e contas do Instagram marcadas durante o consentimento.",
    suggestReauthorize: true,
    allowRetry: true,
    severity: "warning",
  },
  generic: {
    kind: "generic",
    title: "Não foi possível sincronizar alguns dados",
    summary: "Parte das informações da Meta não pôde ser carregada agora.",
    recommendation: "Tente sincronizar novamente. Os dados já carregados continuam disponíveis.",
    suggestReauthorize: false,
    allowRetry: true,
    severity: "warning",
  },
};

/** Estado operacional pronto para toast (título + descrição, sem texto cru). */
export function metaIssueToast(raw: unknown): { title: string; description: string } {
  const msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const state = ISSUE_STATE[classifyMetaIssue(msg)];
  return { title: state.title, description: state.summary };
}

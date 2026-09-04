/**
 * Diagnóstico de reconexão de canal Meta (camada de classificação/apresentação).
 *
 * Motivo real: o modal de reconexão mostrava o erro cru da Graph API
 * (`(#100) Tried accessing nonexistent field (instagram_business_account)`) e
 * oferecia "Nova autorização" como única saída — mesmo quando o problema não era
 * autorização. Aqui o erro é traduzido em UMA categoria operacional com
 * problema → causa provável → ação recomendada.
 *
 * Não há rede, OAuth nem banco neste arquivo: apenas classificação de texto/código.
 */

export type ReconnectDiagnosisKind =
  | "ok"
  | "identity_mismatch"
  | "permission"
  | "not_linked"
  | "unsupported"
  | "not_found"
  | "rate_limit"
  | "generic";

export type ReconnectDiagnosis = {
  kind: ReconnectDiagnosisKind;
  /** Rótulo curto do badge de estado. */
  badge: string;
  /** Problema (título do modal). */
  title: string;
  /** Causa provável, em linguagem operacional. */
  cause: string;
  /** Ação recomendada, objetiva. */
  action: string;
  /** true somente quando reautorizar na Meta realmente resolve. */
  allowReauthorize: boolean;
  /** true quando revalidar/reconectar com a credencial atual faz sentido. */
  allowRetry: boolean;
  severity: "ok" | "warning" | "critical";
};

const DIAGNOSIS: Record<ReconnectDiagnosisKind, ReconnectDiagnosis> = {
  ok: {
    kind: "ok",
    badge: "Reconexão necessária",
    title: "A conta continua a mesma",
    cause: "A Meta confirmou os mesmos identificadores já configurados neste canal.",
    action: "Revalide a autorização para reativar o canal. Nada será substituído.",
    allowReauthorize: false,
    allowRetry: true,
    severity: "ok",
  },
  identity_mismatch: {
    kind: "identity_mismatch",
    badge: "Conta diferente",
    title: "A Meta devolveu uma conta diferente da configurada",
    cause:
      "O identificador que a Meta retorna agora não é o mesmo salvo neste canal — a Página/Instagram pode ter sido trocada, migrada ou vinculada a outro perfil.",
    action:
      "Compare as duas contas abaixo. Nada é substituído sem a sua confirmação: mantenha a conta atual ou passe a usar a nova.",
    allowReauthorize: false,
    allowRetry: false,
    severity: "warning",
  },
  permission: {
    kind: "permission",
    badge: "Permissão",
    title: "A Meta não autoriza a leitura desta conta",
    cause:
      "A autorização atual não cobre esta Página/Instagram, ou o token não é mais válido para o perfil que concedeu o acesso.",
    action:
      "Faça uma nova autorização na Meta mantendo esta Página e a conta do Instagram marcadas durante o consentimento.",
    allowReauthorize: true,
    allowRetry: false,
    severity: "warning",
  },
  not_linked: {
    kind: "not_linked",
    badge: "Conta não vinculada",
    title: "Nenhuma conta profissional do Instagram vinculada à Página",
    cause:
      "A Página do Facebook não tem uma conta Instagram profissional (Business/Creator) vinculada, então a Meta não devolve a conta do Instagram.",
    action:
      "No Gerenciador da Meta, vincule a conta profissional do Instagram a esta Página e verifique novamente. Reautorizar não resolve enquanto o vínculo não existir.",
    allowReauthorize: false,
    allowRetry: true,
    severity: "warning",
  },
  unsupported: {
    kind: "unsupported",
    badge: "Atenção",
    title: "A Meta não aceitou a consulta desta conta",
    cause:
      "O tipo da conta salva não corresponde ao esperado para este canal (por exemplo, um ID de Instagram salvo onde a Meta espera uma Página).",
    action:
      "Verifique novamente. Se o aviso continuar, reconecte este canal escolhendo a Página/Instagram correta na seleção de ativos.",
    allowReauthorize: false,
    allowRetry: true,
    severity: "warning",
  },
  not_found: {
    kind: "not_found",
    badge: "Conta diferente",
    title: "A conta não existe mais na Meta",
    cause:
      "O identificador salvo não é encontrado: a Página/conta pode ter sido excluída, despublicada ou movida para outro portfólio.",
    action:
      "Conecte novamente este canal e selecione a conta correta. Os dados já publicados permanecem intactos.",
    allowReauthorize: true,
    allowRetry: false,
    severity: "critical",
  },
  rate_limit: {
    kind: "rate_limit",
    badge: "Atenção",
    title: "Consulta temporariamente limitada pela Meta",
    cause: "A Meta atingiu o limite de consultas neste momento.",
    action:
      "Aguarde alguns minutos e verifique novamente. Não é necessário reautorizar nada na Meta.",
    allowReauthorize: false,
    allowRetry: true,
    severity: "warning",
  },
  generic: {
    kind: "generic",
    badge: "Atenção",
    title: "Não foi possível verificar esta conta agora",
    cause: "A Meta não respondeu à verificação desta conta.",
    action: "Verifique novamente em instantes. A conta atual permanece preservada.",
    allowReauthorize: false,
    allowRetry: true,
    severity: "warning",
  },
};

export function reconnectDiagnosis(kind: ReconnectDiagnosisKind): ReconnectDiagnosis {
  return DIAGNOSIS[kind] ?? DIAGNOSIS.generic;
}

type GraphLike = { code?: number; error_subcode?: number } | null | undefined;

/**
 * Classifica a falha de leitura da conta em uma categoria operacional.
 * Recebe o código Graph (quando existir) e a mensagem técnica.
 */
export function classifyReconnectFailure(
  message: string | null | undefined,
  graph?: GraphLike,
  status?: number,
): ReconnectDiagnosisKind {
  const msg = (message ?? "").trim();
  const code = graph?.code;

  if (
    code === 4 ||
    code === 17 ||
    code === 32 ||
    /request limit|rate limit|too many calls/i.test(msg)
  )
    return "rate_limit";

  // (#100) campo inexistente para o tipo de nó consultado → consulta inválida,
  // não falta de permissão. Reautorizar NÃO resolve.
  if (
    /nonexistent field|unsupported get request|invalid field|does not support the field/i.test(msg)
  )
    return "unsupported";

  if (code === 803 || status === 404 || /does not exist|não existe|not found/i.test(msg))
    return "not_found";

  if (
    code === 190 ||
    code === 102 ||
    code === 10 ||
    code === 200 ||
    status === 401 ||
    status === 403 ||
    /oauth|access token|permission|permissão|not authorized|sessão expirada/i.test(msg)
  )
    return "permission";

  if (/no instagram|instagram.*not linked|sem instagram|não vinculad/i.test(msg))
    return "not_linked";

  return "generic";
}

/** Mascara um ID técnico mantendo o suficiente para conferência humana. */
export function maskId(id: string | null | undefined): string {
  const v = (id ?? "").trim();
  if (!v) return "—";
  if (v.length <= 6) return v;
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

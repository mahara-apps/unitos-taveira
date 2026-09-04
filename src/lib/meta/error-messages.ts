/**
 * Tradução de erros da Meta para mensagens de domínio (client-safe).
 *
 * O erro técnico completo continua nos logs do servidor; o usuário recebe
 * apenas a instrução acionável. Nunca expõe nome de variável de infraestrutura,
 * stack trace ou segredo.
 */

const AUTH_REQUIRED_TITLE = "Autorização necessária";

export type MetaFriendlyError = {
  title: string;
  description: string;
  /** true = problema de autorização (usuário resolve reconectando). */
  authorization: boolean;
};

const INFRA_PATTERNS = [
  /SB_[A-Z_]+/,
  /SUPABASE_[A-Z_]+/,
  /SERVICE_ROLE/i,
  /Missing .*environment variable/i,
];

export function humanizeMetaError(raw: unknown): MetaFriendlyError {
  const msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";

  if (INFRA_PATTERNS.some((re) => re.test(msg))) {
    return {
      title: "Não foi possível consultar as contas Meta.",
      description: "Tente novamente em instantes.",
      authorization: false,
    };
  }

  if (/\(#10\)|does not have permission/i.test(msg)) {
    return {
      title: AUTH_REQUIRED_TITLE,
      description:
        "Esta conta do Instagram não foi autorizada para publicação neste aplicativo. Reconecte a conta e selecione este Instagram durante o consentimento da Meta.",
      authorization: true,
    };
  }

  if (/\(#190\)|access token|OAuthException/i.test(msg)) {
    return {
      title: "Sessão da Meta expirada.",
      description: "Faça login na Meta novamente para recarregar e reautorizar suas contas.",
      authorization: true,
    };
  }

  if (/\(#200\)|permission/i.test(msg)) {
    return {
      title: AUTH_REQUIRED_TITLE,
      description:
        "A Meta não concedeu as permissões necessárias para esta conta. Reconecte e mantenha todas as permissões marcadas.",
      authorization: true,
    };
  }

  if (/RATE_LIMIT|\(#4\)|\(#17\)|\(#32\)/.test(msg)) {
    return {
      title: "Limite de requisições da Meta atingido.",
      description:
        "Aguarde alguns minutos antes de tentar novamente. As contas já sincronizadas continuam disponíveis.",
      authorization: false,
    };
  }

  return {
    title: "Não foi possível consultar as contas Meta.",
    description: msg || "Tente novamente ou reconecte sua conta Meta.",
    authorization: false,
  };
}

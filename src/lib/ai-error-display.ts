/**
 * Traduz erros de IA/credenciais para uma mensagem curta e acionável em pt-BR.
 * Usado nas telas para nunca mostrar texto técnico cru (ex.: o
 * "The operation failed for an operation-specific reason" do WebCrypto).
 */
const PREFIX_RE = /^[a-z0-9_]+(?::[a-z0-9_-]+)?:\s*/i;

export function aiErrorMessage(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" &&
          err !== null &&
          typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : typeof err === "string"
          ? err
          : "";
  const text = raw.trim();
  if (!text) return fallback;

  if (/operation-specific reason|OperationError/i.test(text)) {
    return "A chave de IA salva não pôde ser lida nesta instalação. Salve a chave do provedor novamente em Configurações > Conexões.";
  }
  if (/column .* does not exist|does not exist/i.test(text) && /media_plan/i.test(text)) {
    return "Esta instalação ainda não recebeu a atualização do plano de mídia. Atualize a instalação e tente de novo.";
  }

  const cleaned = text.replace(PREFIX_RE, "").trim();
  return cleaned || fallback;
}

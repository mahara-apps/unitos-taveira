// Puro (client-safe): normalização e validação de destinos de WhatsApp.
// Um destino é SEMPRE de um dos dois tipos abaixo — nunca se assume que uma
// sequência de dígitos é telefone quando o destinatário é grupo.

export type WhatsappDestinationKind = "phone" | "group";

export type WhatsappDestination = {
  kind: WhatsappDestinationKind;
  /** Telefone em dígitos (E.164 sem "+") ou o JID do grupo, como a Evolution devolve. */
  value: string;
};

/** JID de grupo conforme retornado/aceito pela Evolution (ex.: 1203630000@g.us). */
const GROUP_JID_RE = /^[0-9]+(-[0-9]+)?@g\.us$/;

export function isGroupJid(value: unknown): boolean {
  return typeof value === "string" && GROUP_JID_RE.test(value.trim());
}

/**
 * Normaliza um telefone para dígitos E.164 sem "+".
 * Números brasileiros locais (10/11 dígitos) recebem o DDI 55.
 * Retorna `null` quando o valor não é um telefone utilizável.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const input = String(raw).trim();
  if (!input || isGroupJid(input)) return null;
  // Um JID de usuário (5531...@s.whatsapp.net) também é aceito pelo número.
  const local = input.split("@")[0] ?? "";
  let digits = local.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/** Interpreta um destino cru já validado por tipo. */
export function parseDestination(
  kind: WhatsappDestinationKind,
  raw: unknown,
): WhatsappDestination | null {
  if (kind === "group") {
    const value = typeof raw === "string" ? raw.trim() : "";
    return isGroupJid(value) ? { kind: "group", value } : null;
  }
  const phone = normalizePhone(raw);
  return phone ? { kind: "phone", value: phone } : null;
}

/** Valor exato enviado à Evolution no campo `number`. */
export function toEvolutionNumber(destination: WhatsappDestination): string {
  return destination.value;
}

/** Rótulo seguro para exibição/log (mascara o miolo do telefone). */
export function maskDestination(destination: WhatsappDestination): string {
  if (destination.kind === "group") return destination.value;
  const v = destination.value;
  if (v.length <= 6) return v;
  return `${v.slice(0, 4)}****${v.slice(-2)}`;
}

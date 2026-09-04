// Client-safe: rótulos de estado e formatação de telefone para a área WhatsApp.
// Apenas apresentação — nenhuma regra de negócio nem chamada de provedor.

export type WhatsappStage =
  | "unconfigured"
  | "configured"
  | "created"
  | "awaiting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export const WHATSAPP_STAGE_LABELS: Record<WhatsappStage, string> = {
  unconfigured: "Não configurada",
  configured: "Configurada",
  created: "Instância criada",
  awaiting: "Aguardando conexão",
  connecting: "Conectando",
  connected: "Conectado",
  disconnected: "Desconectado",
  error: "Erro",
};

/** Cor do marcador (usa tokens semânticos do design system). */
export function stageDot(stage: WhatsappStage) {
  if (stage === "connected") return "bg-health-good";
  if (stage === "awaiting" || stage === "connecting") return "bg-health-warn";
  if (stage === "error") return "bg-destructive";
  return "bg-muted-foreground";
}

export function stageBadgeVariant(stage: WhatsappStage) {
  if (stage === "connected") return "default" as const;
  if (stage === "awaiting" || stage === "connecting") return "secondary" as const;
  if (stage === "error") return "destructive" as const;
  return "outline" as const;
}

/** Deriva o estágio a partir da configuração + estado da instância. */
export function deriveStage(input: {
  configured: boolean;
  instanceStatus: string | null;
}): WhatsappStage {
  if (!input.configured) return "unconfigured";
  if (!input.instanceStatus) return "configured";
  switch (input.instanceStatus) {
    case "connected":
      return "connected";
    case "qr_pending":
      return "awaiting";
    case "connecting":
      return "connecting";
    case "created":
      return "created";
    case "missing":
      return "error";
    default:
      return "disconnected";
  }
}

/** Formata dígitos E.164 (sem "+") de forma legível. */
export function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return raw;
  const ddi = digits.slice(0, digits.length - 10);
  const rest = digits.slice(-10);
  const ddd = rest.slice(0, 2);
  const body = rest.slice(2);
  const head = body.length > 4 ? body.slice(0, body.length - 4) : body;
  const tail = body.slice(-4);
  return `+${ddi || "55"} ${ddd} ${head}-${tail}`;
}

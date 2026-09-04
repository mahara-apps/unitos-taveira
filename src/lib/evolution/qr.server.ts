// Server-only: fluxo de conexão por QR Code na Evolution API.
// Escopo: solicitar o QR (ou código de pareamento) e normalizar o payload.
// Não trata webhook, inbox nem envio de mensagens.

import type { EvolutionConfig } from "./config.server";
import { EvolutionApiError, evolutionRequest } from "./client.server";

export type EvolutionQrPayload = {
  /** Imagem do QR em data URL (image/png;base64), quando disponível. */
  qrBase64: string | null;
  /** Código bruto do QR, para renderização alternativa. */
  qrCode: string | null;
  /** Código de pareamento por telefone (8 dígitos), quando o provedor envia. */
  pairingCode: string | null;
  /** Quantidade de QRs já emitidos nesta sessão de pareamento. */
  count: number | null;
  /** Verdadeiro quando o provedor indica que a instância já está conectada. */
  alreadyConnected: boolean;
  requestedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeBase64(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 32) return null;
  return value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
}

/**
 * Solicita a conexão da instância e devolve o QR normalizado.
 * Instância inexistente no provedor lança `EvolutionApiError('not_found')`.
 */
export async function requestEvolutionQr(
  config: EvolutionConfig,
  instanceName: string,
): Promise<EvolutionQrPayload> {
  const requestedAt = new Date().toISOString();
  const { data } = await evolutionRequest<unknown>(config, {
    method: "GET",
    path: `/instance/connect/${encodeURIComponent(instanceName)}`,
    attempts: 1,
    timeoutMs: 15_000,
  });

  const record = asRecord(data) ?? {};
  const nested = asRecord(record["qrcode"]) ?? asRecord(record["qr"]) ?? {};

  const qrBase64 =
    normalizeBase64(record["base64"]) ?? normalizeBase64(nested["base64"]) ?? null;
  const qrCode =
    (typeof record["code"] === "string" ? (record["code"] as string) : null) ??
    (typeof nested["code"] === "string" ? (nested["code"] as string) : null);
  const pairingCode =
    (typeof record["pairingCode"] === "string" ? (record["pairingCode"] as string) : null) ??
    (typeof nested["pairingCode"] === "string" ? (nested["pairingCode"] as string) : null);
  const rawCount = record["count"] ?? nested["count"];
  const count = typeof rawCount === "number" ? rawCount : null;

  const instanceState = String(
    asRecord(record["instance"])?.["state"] ?? record["state"] ?? "",
  ).toLowerCase();
  const alreadyConnected =
    !qrBase64 && !qrCode && (instanceState === "open" || instanceState === "connected");

  return { qrBase64, qrCode, pairingCode, count, alreadyConnected, requestedAt };
}

/** Traduz falhas do provedor em mensagem apresentável para a tela de QR. */
export function describeQrFailure(error: unknown): string {
  if (error instanceof EvolutionApiError) {
    if (error.code === "not_found") {
      return "Instância inexistente no servidor Evolution. Recrie a instância.";
    }
    return error.message;
  }
  return "Não foi possível gerar o QR Code agora. Tente novamente.";
}

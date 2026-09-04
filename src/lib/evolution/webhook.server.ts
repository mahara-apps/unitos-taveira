// Server-only: recebimento de webhooks da Evolution API.
// A Evolution (v2) NÃO assina o corpo do evento — o mecanismo disponível é o
// envio de headers/URL configurados na criação do webhook. Por isso cada
// instância recebe um token secreto próprio, usado na URL e no header
// `x-evolution-token`; a validação é feita por comparação de tempo constante
// contra o token da instância. Nenhum evento é aceito sem token válido.

import { timingSafeEqual } from "crypto";
import { evolutionRequest } from "./client.server";
import type { EvolutionConfig } from "./config.server";

/** Eventos que o Unitos precisa persistir nesta fase (conexão/estado). */
export const EVOLUTION_WEBHOOK_EVENTS = [
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "LOGOUT_INSTANCE",
  "INSTANCE_DELETE",
] as const;

export function generateWebhookToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação de tempo constante tolerante a tamanhos diferentes. */
export function safeTokenEquals(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** URL pública do receptor de webhooks para uma instância. */
export function buildWebhookUrl(appBaseUrl: string, token: string) {
  return `${appBaseUrl.replace(/\/+$/, "")}/api/public/hooks/evolution/${token}`;
}

/** Registra (ou atualiza) o webhook da instância no servidor Evolution. */
export async function setEvolutionWebhook(
  config: EvolutionConfig,
  instanceName: string,
  webhookUrl: string,
  token: string,
) {
  const body = {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: true,
      headers: {
        "content-type": "application/json",
        "x-evolution-token": token,
      },
      events: [...EVOLUTION_WEBHOOK_EVENTS],
    },
    // Versões mais antigas aceitam o formato plano.
    enabled: true,
    url: webhookUrl,
    webhook_by_events: false,
    events: [...EVOLUTION_WEBHOOK_EVENTS],
  };
  const { data } = await evolutionRequest<unknown>(config, {
    method: "POST",
    path: `/webhook/set/${encodeURIComponent(instanceName)}`,
    body,
    attempts: 1,
  });
  return { raw: data };
}

export type NormalizedEvolutionEvent = {
  eventType: string;
  instanceName: string | null;
  providerEventId: string | null;
  connectionState: string | null;
  phoneNumber: string | null;
  /** Estado derivado para `evolution_instances.status`, quando aplicável. */
  instanceStatus: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeState(value: unknown): string | null {
  const raw = String(value ?? "").toLowerCase();
  if (!raw) return null;
  if (raw === "open" || raw === "connected") return "open";
  if (raw === "connecting" || raw === "qr" || raw === "pairing") return "connecting";
  if (raw === "close" || raw === "closed" || raw === "disconnected") return "close";
  return raw;
}

function extractPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

/** Normaliza o payload bruto do provedor no formato persistido pelo Unitos. */
export function normalizeEvolutionEvent(payload: unknown): NormalizedEvolutionEvent {
  const root = asRecord(payload) ?? {};
  const eventType = String(root["event"] ?? root["type"] ?? "unknown")
    .toUpperCase()
    .replace(/[.\s-]+/g, "_");
  const data = asRecord(root["data"]) ?? {};
  const instanceName =
    (typeof root["instance"] === "string" ? (root["instance"] as string) : null) ??
    (typeof root["instanceName"] === "string" ? (root["instanceName"] as string) : null) ??
    (typeof data["instance"] === "string" ? (data["instance"] as string) : null);

  const connectionState = normalizeState(data["state"] ?? data["connection"] ?? root["state"]);
  const phoneNumber =
    extractPhone(data["wuid"]) ??
    extractPhone(data["ownerJid"]) ??
    extractPhone(data["owner"]) ??
    extractPhone(root["sender"]);

  const providerEventId =
    (typeof root["id"] === "string" ? (root["id"] as string) : null) ??
    (typeof data["id"] === "string" ? (data["id"] as string) : null) ??
    (typeof root["date_time"] === "string" ? `${eventType}:${root["date_time"]}` : null);

  let instanceStatus: string | null = null;
  if (eventType === "CONNECTION_UPDATE") {
    instanceStatus =
      connectionState === "open"
        ? "connected"
        : connectionState === "connecting"
          ? "connecting"
          : connectionState === "close"
            ? "disconnected"
            : null;
  } else if (eventType === "QRCODE_UPDATED") {
    instanceStatus = "qr_pending";
  } else if (eventType === "LOGOUT_INSTANCE") {
    instanceStatus = "disconnected";
  } else if (eventType === "INSTANCE_DELETE") {
    instanceStatus = "missing";
  }

  return { eventType, instanceName, providerEventId, connectionState, phoneNumber, instanceStatus };
}

/** Recorte seguro do payload: sem base64 de QR, mídia ou conteúdo de mensagem. */
export function safeEventPayload(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root["data"]) ?? {};
  const keep: Record<string, unknown> = {};
  for (const key of ["state", "connection", "statusReason", "reason", "lastDisconnect"]) {
    if (data[key] !== undefined) keep[key] = data[key];
  }
  return {
    event: root["event"] ?? null,
    date_time: root["date_time"] ?? null,
    server_url: undefined,
    data: keep,
  };
}

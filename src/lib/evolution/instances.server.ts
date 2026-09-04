// Server-only: ciclo de vida de instâncias na Evolution API.
// Escopo: criar, consultar estado, reiniciar, desconectar (logout) e excluir.
// Não trata QR, webhook, inbox nem envio de mensagens.

import type { EvolutionConfig } from "./config.server";
import { EvolutionApiError, evolutionRequest } from "./client.server";

/** Estados normalizados de conexão de uma instância. */
export type EvolutionConnectionState =
  | "open"
  | "connecting"
  | "close"
  | "unknown"
  | "not_found";

export type EvolutionInstanceState = {
  state: EvolutionConnectionState;
  /** Número conectado, quando o provedor informa. */
  phoneNumber: string | null;
  raw: unknown;
};

/**
 * Nome técnico da instância na Evolution. Determinístico e único por
 * workspace/cliente, para nunca colidir com instâncias de outro tenant.
 */
export function buildInstanceName(brandId: string, clientId: string | null, suffix: string) {
  const slug = suffix
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const scope = (clientId ?? brandId).slice(0, 8);
  return `u-${brandId.slice(0, 8)}-${scope}-${slug || "wa"}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeState(value: unknown): EvolutionConnectionState {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "open" || raw === "connected") return "open";
  if (raw === "connecting" || raw === "qr" || raw === "pairing") return "connecting";
  if (raw === "close" || raw === "closed" || raw === "disconnected") return "close";
  return "unknown";
}

function extractPhone(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const candidate =
    (payload["number"] as string | undefined) ??
    (payload["ownerJid"] as string | undefined) ??
    (payload["owner"] as string | undefined) ??
    (asRecord(payload["instance"])?.["owner"] as string | undefined);
  if (!candidate) return null;
  const digits = String(candidate).split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

/** Cria a instância na Evolution (sem solicitar QR). */
export async function createEvolutionInstance(
  config: EvolutionConfig,
  instanceName: string,
): Promise<{ raw: unknown }> {
  const { data } = await evolutionRequest<unknown>(config, {
    method: "POST",
    path: "/instance/create",
    body: {
      instanceName,
      qrcode: false,
      integration: "WHATSAPP-BAILEYS",
    },
    attempts: 1,
  });
  return { raw: data };
}

/** Consulta o estado de conexão. Instância inexistente devolve `not_found`. */
export async function fetchEvolutionInstanceState(
  config: EvolutionConfig,
  instanceName: string,
): Promise<EvolutionInstanceState> {
  try {
    const { data } = await evolutionRequest<unknown>(config, {
      method: "GET",
      path: `/instance/connectionState/${encodeURIComponent(instanceName)}`,
      attempts: 2,
    });
    const record = asRecord(data);
    const instance = asRecord(record?.["instance"]) ?? record;
    return {
      state: normalizeState(instance?.["state"] ?? record?.["state"]),
      phoneNumber: extractPhone(instance),
      raw: data,
    };
  } catch (error) {
    if (error instanceof EvolutionApiError && error.code === "not_found") {
      return { state: "not_found", phoneNumber: null, raw: null };
    }
    throw error;
  }
}

/** Reinicia a instância (mantém a sessão quando possível). */
export async function restartEvolutionInstance(config: EvolutionConfig, instanceName: string) {
  const { data } = await evolutionRequest<unknown>(config, {
    method: "POST",
    path: `/instance/restart/${encodeURIComponent(instanceName)}`,
    attempts: 1,
  });
  return { raw: data };
}

/** Desconecta o número (logout) mantendo a instância criada. */
export async function logoutEvolutionInstance(config: EvolutionConfig, instanceName: string) {
  try {
    const { data } = await evolutionRequest<unknown>(config, {
      method: "DELETE",
      path: `/instance/logout/${encodeURIComponent(instanceName)}`,
      attempts: 1,
    });
    return { raw: data, missing: false };
  } catch (error) {
    if (error instanceof EvolutionApiError && error.code === "not_found") {
      return { raw: null, missing: true };
    }
    throw error;
  }
}

/** Exclui a instância no provedor. `missing` indica que já não existia. */
export async function deleteEvolutionInstance(config: EvolutionConfig, instanceName: string) {
  try {
    const { data } = await evolutionRequest<unknown>(config, {
      method: "DELETE",
      path: `/instance/delete/${encodeURIComponent(instanceName)}`,
      attempts: 1,
    });
    return { raw: data, missing: false };
  } catch (error) {
    if (error instanceof EvolutionApiError && error.code === "not_found") {
      return { raw: null, missing: true };
    }
    throw error;
  }
}

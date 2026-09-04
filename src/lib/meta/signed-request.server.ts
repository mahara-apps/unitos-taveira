/**
 * Meta `signed_request` helpers — server-only.
 * Format: <base64url_signature>.<base64url_json_payload>
 * Signature = HMAC-SHA256(payload_string, app_secret).
 */

import { readRuntimeEnv } from "@/lib/runtime-env.server";

export type MetaSignedPayload = {
  algorithm?: string;
  issued_at?: number;
  user_id?: string;
  [key: string]: unknown;
};

export async function parseMetaSignedRequest(
  signedRequest: string,
  appSecret: string,
): Promise<MetaSignedPayload | null> {
  const [sigB64, payloadB64] = signedRequest.split(".");
  if (!sigB64 || !payloadB64) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
  );
  const expected = base64UrlEncode(macBytes);
  if (!timingSafeEqual(expected, sigB64)) return null;

  let payload: MetaSignedPayload;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    payload = JSON.parse(json) as MetaSignedPayload;
  } catch {
    return null;
  }
  if (payload.algorithm && payload.algorithm.toUpperCase() !== "HMAC-SHA256") {
    return null;
  }
  return payload;
}

export function buildConfirmationCode(prefix: string, metaUserId: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${metaUserId}_${Date.now().toString(36)}_${rand}`;
}

export function confirmationUrl(code: string): string {
  // Each installation has its own domain — no hardcoded fallback, otherwise a
  // new installation would point Meta at another installation's domain.
  const raw = readRuntimeEnv("PUBLIC_APP_URL") ?? readRuntimeEnv("VITE_PUBLIC_APP_URL");
  if (!raw) {
    throw new Error("Meta integration is not configured: missing PUBLIC_APP_URL");
  }
  const base = raw.replace(/\/$/, "");
  return `${base}/api/public/meta/deletion-status?code=${encodeURIComponent(code)}`;
}

function base64UrlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

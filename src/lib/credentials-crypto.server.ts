// Server-only AES-256-GCM helpers for encrypting per-brand API credentials.
// Uses Web Crypto (available on Cloudflare Workers and Node ≥ 20).
// Key material comes from BRAND_CREDENTIALS_SECRET (auto-provisioned).

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(): Promise<CryptoKey> {
  const raw = process.env.BRAND_CREDENTIALS_SECRET;
  if (!raw) throw new Error("BRAND_CREDENTIALS_SECRET is not set");
  // Derive a stable 32-byte AES key from the secret via SHA-256.
  const material = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptCredential(stored: string): Promise<string> {
  const key = await importKey();
  const buf = b64decode(stored);
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export function maskCredential(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "•".repeat(Math.max(trimmed.length, 4));
  return `${trimmed.slice(0, 4)}${"•".repeat(Math.max(4, trimmed.length - 8))}${trimmed.slice(-4)}`;
}

// ⚠️ Server-only: converte anexos de chat_messages em blocos multimodais que
// o AI SDK (via @ai-sdk/openai-compatible) sabe encaminhar ao Gateway.
//
// Suporte:
//   - image/*      → { type: 'image', image: <signedUrl> }
//   - application/pdf, text/*, application/json → { type: 'file', data: bytes, mediaType }
//   - audio/*      → apenas texto informativo (o converter openai-compat só
//                    aceita wav/mp3, e nossas gravações são webm — pulamos).
//   - outros       → apenas texto informativo.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserContent } from "ai";

export interface ChatAttachmentInput {
  path: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "audio" | "pdf" | "file";
}

const BUCKET = "chat-attachments";
const MAX_FILE_MB = 20;

async function signedUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// Resiliência do download de anexos (padrão PADRAO_INTEGRACOES_EXTERNAS):
// timeout 15s, classificação, retry apenas para rede/5xx/429 e telemetria.
export const MULTIMODAL_DOWNLOAD_TIMEOUT_MS = 15_000;
export const MULTIMODAL_MAX_ATTEMPTS = 2;

export type MultimodalDownloadOutcome =
  | { kind: "http"; status: number }
  | { kind: "timeout" }
  | { kind: "network" };

export function classifyMultimodalOutcome(o: MultimodalDownloadOutcome): "recoverable" | "terminal" {
  if (o.kind === "timeout" || o.kind === "network") return "recoverable";
  if (o.status === 429 || o.status >= 500) return "recoverable";
  return "terminal";
}

export interface MultimodalDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  now?: () => number;
  logger?: (line: Record<string, unknown>) => void;
}

function multimodalLog(logger: MultimodalDeps["logger"], line: Record<string, unknown>) {
  try {
    (logger ?? ((l) => console.warn("[multimodal]", JSON.stringify(l))))(line);
  } catch { /* telemetria nunca derruba o fluxo */ }
}

export function multimodalBackoffMs(attempt: number, rand: () => number = Math.random): number {
  // 500ms, 1000ms... + jitter de até 50%
  return Math.round(500 * 2 ** (attempt - 1) * (1 + rand() * 0.5));
}

export interface DownloadFailure {
  reason: "timeout" | "network" | "http" | "too_large";
  status?: number;
  attempts: number;
}

/**
 * Baixa um anexo com timeout e retry limitado. Retorna null somente após
 * esgotar tentativas recuperáveis ou em erro terminal — nunca silenciosamente:
 * toda falha é registrada em telemetria estruturada e em `lastFailure`.
 */
export async function downloadAttachment(
  url: string,
  name: string,
  deps: MultimodalDeps = {},
  lastFailure?: { current?: DownloadFailure },
): Promise<Uint8Array | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const rand = deps.rand ?? Math.random;
  const now = deps.now ?? Date.now;

  for (let attempt = 1; attempt <= MULTIMODAL_MAX_ATTEMPTS; attempt++) {
    const startedAt = now();
    let outcome: MultimodalDownloadOutcome | null = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), MULTIMODAL_DOWNLOAD_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetchImpl(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        outcome = { kind: "http", status: res.status };
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > MAX_FILE_MB * 1024 * 1024) {
          multimodalLog(deps.logger, { event: "attachment_download", name, attempts: attempt, reason: "too_large", bytes: buf.length });
          if (lastFailure) lastFailure.current = { reason: "too_large", attempts: attempt };
          return null;
        }
        return buf;
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      outcome = isAbort ? { kind: "timeout" } : { kind: "network" };
    }

    const classification = classifyMultimodalOutcome(outcome);
    multimodalLog(deps.logger, {
      event: "attachment_download",
      name,
      attempts: attempt,
      reason: outcome.kind,
      status: outcome.kind === "http" ? outcome.status : undefined,
      classification,
      durationMs: now() - startedAt,
    });
    if (lastFailure) {
      lastFailure.current = {
        reason: outcome.kind,
        status: outcome.kind === "http" ? outcome.status : undefined,
        attempts: attempt,
      };
    }
    if (classification === "terminal" || attempt === MULTIMODAL_MAX_ATTEMPTS) return null;
    await sleep(multimodalBackoffMs(attempt, rand));
  }
  return null;
}

async function downloadBase64(url: string, name: string): Promise<Uint8Array | null> {
  return downloadAttachment(url, name);
}

/**
 * Retorna o array de blocos UserContent para uma mensagem de usuário que
 * contém texto + anexos. Devolve também um "resumo" texto dos anexos que
 * não puderam ser materializados (para o modelo saber que eles existem).
 */
export async function buildMultimodalContent(
  supabase: SupabaseClient,
  text: string,
  attachments: ChatAttachmentInput[],
): Promise<UserContent> {
  const blocks: UserContent = [];
  const skipped: string[] = [];

  if (text.trim()) blocks.push({ type: "text", text });

  for (const att of attachments) {
    const url = await signedUrl(supabase, att.path);
    if (!url) {
      skipped.push(`${att.name} (falha ao gerar URL)`);
      continue;
    }

    if (att.kind === "image" && att.mime.startsWith("image/")) {
      // image aceita URL direta — mais eficiente que base64.
      blocks.push({ type: "image", image: new URL(url), mediaType: att.mime });
      continue;
    }

    if (att.kind === "pdf" || att.mime === "application/pdf") {
      const bytes = await downloadBase64(url, att.name);
      if (!bytes) {
        skipped.push(`${att.name} (>20MB ou falha no download)`);
        continue;
      }
      blocks.push({ type: "file", data: bytes, mediaType: "application/pdf", filename: att.name });
      continue;
    }

    if (att.mime.startsWith("text/") || att.mime === "application/json") {
      const bytes = await downloadBase64(url, att.name);
      if (bytes) {
        const asText = new TextDecoder().decode(bytes).slice(0, 20_000);
        blocks.push({
          type: "text",
          text: `\n\n--- Anexo: ${att.name} ---\n${asText}\n--- fim ---`,
        });
        continue;
      }
    }

    // audio + demais → apenas menção
    skipped.push(`${att.name} (${att.mime}) — envio como referência textual`);
  }

  if (skipped.length) {
    blocks.push({
      type: "text",
      text: `\n\nAnexos não materializados (o usuário anexou, mas você não recebe o conteúdo binário):\n- ${skipped.join("\n- ")}`,
    });
  }

  if (blocks.length === 0) {
    blocks.push({ type: "text", text: "(mensagem vazia)" });
  }

  return blocks;
}

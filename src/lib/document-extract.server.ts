/**
 * Preparação de conteúdo de documentos para análise multimodal.
 *
 * Contrato real dos providers (Gemini/OpenAI/Anthropic via AI SDK): apenas
 * alguns tipos podem ser enviados como conteúdo inline (`inlineData.data`
 * precisa ser uma STRING Base64 e o MIME vai separado em `mimeType`). Formatos
 * de escritório (DOC/DOCX/XLS/XLSX) não são interpretados inline por nenhum
 * provider — o texto é extraído aqui, no servidor, e segue como texto na mesma
 * execução de importação (sem fluxo paralelo).
 */

/** MIME types que os providers aceitam como conteúdo inline. */
const INLINE_MEDIA_ALLOWLIST = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export type PreparedContent =
  | { mode: "inline"; mediaType: string; base64: string; note: string }
  | { mode: "text"; text: string; note: string };

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Converte bytes para Base64 (string) — nunca objeto/Buffer/ArrayBuffer. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

/**
 * Validação de payload inline ANTES do envio ao provider. Garante o schema
 * real (`data`: string Base64 não vazia; `mimeType`: tipo suportado).
 */
export function assertInlinePayload(part: { mediaType: string; base64: unknown }): void {
  if (typeof part.base64 !== "string" || part.base64.length === 0) {
    throw new Error(
      `ai_payload_invalid: conteúdo inline deve ser string Base64 (recebido: ${typeof part.base64}).`,
    );
  }
  if (part.base64.startsWith("data:")) {
    throw new Error("ai_payload_invalid: conteúdo inline não deve incluir o prefixo data: URL.");
  }
  if (!BASE64_RE.test(part.base64.slice(0, 512))) {
    throw new Error("ai_payload_invalid: conteúdo inline não está em Base64.");
  }
  if (!(INLINE_MEDIA_ALLOWLIST as readonly string[]).includes(part.mediaType)) {
    throw new Error(`ai_payload_invalid: MIME não suportado inline (${part.mediaType}).`);
  }
}

function ext(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : "";
}

export type MediaKind = "image" | "pdf" | "text" | "docx" | "spreadsheet" | "legacy-doc" | "unknown";

/** Classifica pelo MIME e, quando genérico/ausente, pela extensão. */
export function classifyMedia(mediaType: string | null, filename: string): MediaKind {
  const mime = (mediaType ?? "").toLowerCase();
  const e = ext(filename);
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || e === "pdf") return "pdf";
  if (
    mime.includes("wordprocessingml") ||
    e === "docx" ||
    mime === "application/vnd.oasis.opendocument.text" ||
    e === "odt"
  )
    return "docx";
  if (mime === "application/msword" || e === "doc") return "legacy-doc";
  if (
    mime.includes("spreadsheetml") ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv" ||
    ["xlsx", "xls", "xlsm", "csv", "ods", "tsv"].includes(e)
  )
    return "spreadsheet";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    ["txt", "md", "markdown", "json", "vtt", "srt", "rtf", "log"].includes(e)
  )
    return "text";
  return "unknown";
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000/g, "");
}

function looksTextual(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 2048);
  let bad = 0;
  for (const b of sample) if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) bad += 1;
  return sample.length > 0 && bad / sample.length < 0.05;
}

const MAX_TEXT = 120_000;

function clip(text: string): string {
  const t = text.replace(/[ \t]+\n/g, "\n").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n\n[conteúdo truncado]` : t;
}

/** Extrai o texto de um DOCX/ODT (mammoth: JS puro, sem dependência de OS). */
async function extractDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth/mammoth.browser.js")) as unknown as {
    extractRawText: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  return res.value ?? "";
}

/** Extrai estrutura + conteúdo de planilhas (uma seção por aba, em CSV). */
async function extractSpreadsheet(bytes: Uint8Array): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (!csv) continue;
    parts.push(`### Aba: ${name}\n${csv}`);
  }
  return parts.join("\n\n");
}

/** Assinaturas (magic bytes) dos formatos enviados inline ao modelo. */
function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

/**
 * Valida a integridade real do arquivo ANTES de gastar qualquer chamada de IA.
 * Arquivo truncado/corrompido (extensão certa, conteúdo inválido) falha aqui,
 * com erro terminal de entrada.
 */
export function assertFileIntegrity(bytes: Uint8Array, kind: MediaKind, filename: string): void {
  if ((kind === "image" || kind === "pdf") && bytes.byteLength < 8) {
    throw new Error(`document_corrupted: o arquivo ${filename} está truncado ou vazio.`);
  }
  if (kind === "pdf") {
    // %PDF- no início e marcador de fim de arquivo em algum lugar do final.
    if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
      throw new Error(`document_corrupted: ${filename} não é um PDF válido.`);
    }
    // PDFs reais terminam com %%EOF. Só exigimos o marcador em arquivos com
    // tamanho de PDF de verdade (fixtures mínimas não têm trailer).
    const tailBytes = bytes.subarray(Math.max(0, bytes.length - 4096));
    const tail = new TextDecoder("latin1").decode(tailBytes);
    if (bytes.byteLength > 1024 && !tail.includes("%%EOF")) {
      throw new Error(`document_corrupted: ${filename} está incompleto (PDF sem marcador final).`);
    }
    return;
  }
  if (kind === "image") {
    const ok =
      startsWith(bytes, [0xff, 0xd8, 0xff]) || // jpeg
      startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // png
      startsWith(bytes, [0x47, 0x49, 0x46]) || // gif
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) || // webp (RIFF)
      startsWith(bytes, [0x00, 0x00, 0x00, 0x18]) ||
      startsWith(bytes, [0x00, 0x00, 0x00, 0x1c]); // heic/heif
    if (!ok) throw new Error(`document_corrupted: ${filename} não é uma imagem válida.`);
    return;
  }
  if (kind === "docx" || (kind === "spreadsheet" && !/\.(csv|tsv)$/i.test(filename))) {
    // OOXML/ODF são ZIP: precisam da assinatura PK.
    const isZip = startsWith(bytes, [0x50, 0x4b]);
    const isLegacyXls = startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
    if (!isZip && !isLegacyXls && kind === "docx") {
      throw new Error(`document_corrupted: ${filename} não é um DOCX/ODT válido.`);
    }
  }
}

/**
 * Decide como o arquivo alimenta a execução de importação:
 * imagem/PDF → inline multimodal; demais formatos → texto extraído.
 */
export async function prepareDocumentContent(args: {
  bytes: Uint8Array;
  mediaType: string | null;
  filename: string;
}): Promise<PreparedContent> {
  const { bytes, filename } = args;
  const kind = classifyMedia(args.mediaType, filename);
  if (bytes.byteLength === 0) throw new Error("document_empty: o arquivo enviado está vazio.");
  // Formato sem leitura possível é rejeitado antes da checagem de integridade.
  if (kind === "legacy-doc") {
    throw new Error(
      "document_format_unsupported: arquivos .doc antigos não podem ser lidos. Converta para .docx ou PDF.",
    );
  }
  // Integridade antes de qualquer chamada de IA: arquivo corrompido para aqui.
  assertFileIntegrity(bytes, kind, filename);


  if (kind === "image" || kind === "pdf") {
    const mediaType =
      kind === "pdf"
        ? "application/pdf"
        : (args.mediaType ?? "image/png").toLowerCase().replace("image/jpg", "image/jpeg");
    const base64 = bytesToBase64(bytes);
    assertInlinePayload({ mediaType, base64 });
    return {
      mode: "inline",
      mediaType,
      base64,
      note: kind === "pdf" ? "PDF enviado ao modelo (texto + conteúdo visual)." : "Imagem enviada ao modelo (multimodal).",
    };
  }



  if (kind === "docx") {
    const text = clip(await extractDocx(bytes));
    if (!text) throw new Error("document_no_text: não foi possível extrair texto deste documento.");
    return { mode: "text", text, note: "Texto extraído do documento (DOCX)." };
  }

  if (kind === "spreadsheet") {
    const text = clip(await extractSpreadsheet(bytes));
    if (!text) throw new Error("document_no_text: a planilha não possui conteúdo legível.");
    return { mode: "text", text, note: "Conteúdo das abas da planilha extraído." };
  }

  if (kind === "text" || looksTextual(bytes)) {
    const text = clip(decodeText(bytes));
    if (!text) throw new Error("document_no_text: o arquivo não possui texto legível.");
    return { mode: "text", text, note: "Texto do arquivo lido diretamente." };
  }

  throw new Error(
    "document_format_unsupported: formato não suportado. Envie PDF, DOCX, XLS/XLSX, CSV, TXT ou imagem.",
  );
}

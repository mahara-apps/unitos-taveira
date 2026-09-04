import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertInlinePayload,
  bytesToBase64,
  classifyMedia,
  prepareDocumentContent,
} from "@/lib/document-extract.server";
import { friendlyAnalysisError, importErrorMessage } from "@/lib/briefing-import-ui";

const enc = (s: string) => new TextEncoder().encode(s);

describe("classifyMedia", () => {
  it("classifica por MIME e por extensão quando o MIME é genérico", () => {
    expect(classifyMedia("image/png", "a.png")).toBe("image");
    expect(classifyMedia("application/pdf", "a.pdf")).toBe("pdf");
    expect(classifyMedia("application/octet-stream", "a.pdf")).toBe("pdf");
    expect(
      classifyMedia(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe("docx");
    expect(classifyMedia("application/msword", "a.doc")).toBe("legacy-doc");
    expect(classifyMedia("text/csv", "a.csv")).toBe("spreadsheet");
    expect(classifyMedia("application/octet-stream", "a.xlsx")).toBe("spreadsheet");
    expect(classifyMedia("text/plain", "a.txt")).toBe("text");
    expect(classifyMedia(null, "a.vtt")).toBe("text");
    expect(classifyMedia("application/zip", "a.zip")).toBe("unknown");
  });
});

describe("assertInlinePayload", () => {
  it("aceita string Base64 com MIME suportado", () => {
    expect(() =>
      assertInlinePayload({ mediaType: "image/png", base64: bytesToBase64(enc("hello")) }),
    ).not.toThrow();
  });

  it("rejeita objeto no lugar de string (causa do erro inline_data)", () => {
    expect(() =>
      assertInlinePayload({ mediaType: "image/png", base64: { type: "data", data: "x" } }),
    ).toThrow(/ai_payload_invalid/);
  });

  it("rejeita data: URL e MIME não suportado inline", () => {
    expect(() =>
      assertInlinePayload({ mediaType: "image/png", base64: "data:image/png;base64,AAAA" }),
    ).toThrow(/ai_payload_invalid/);
    expect(() => assertInlinePayload({ mediaType: "text/csv", base64: "AAAA" })).toThrow(
      /MIME não suportado/,
    );
  });
});

describe("prepareDocumentContent", () => {
  it("DOCX real enviado → texto de briefing e reunião", async () => {
    const path = fileURLToPath(new URL("./fixtures/briefing-use-do-avesso.docx", import.meta.url));
    const bytes = new Uint8Array(await readFile(path));
    const out = await prepareDocumentContent({
      bytes,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "Reunião de briefing - Use do Avesso.docx",
    });
    expect(out.mode).toBe("text");
    if (out.mode === "text") {
      expect(out.text.length).toBeGreaterThan(16_000);
      expect(out.text).toContain("Use do Avesso");
      expect(out.text).toMatch(/reunião|briefing/i);
    }
  });

  it("imagem → inline com Base64 string", async () => {
    const out = await prepareDocumentContent({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
      mediaType: "image/png",
      filename: "logo.png",
    });
    expect(out.mode).toBe("inline");
    if (out.mode === "inline") {
      expect(typeof out.base64).toBe("string");
      expect(out.mediaType).toBe("image/png");
    }
  });

  it("PDF → inline application/pdf", async () => {
    const out = await prepareDocumentContent({
      bytes: enc("%PDF-1.4 conteudo"),
      mediaType: "application/pdf",
      filename: "brief.pdf",
    });
    expect(out.mode).toBe("inline");
    if (out.mode === "inline") expect(out.mediaType).toBe("application/pdf");
  });

  it("TXT e CSV → texto", async () => {
    const txt = await prepareDocumentContent({
      bytes: enc("Missão: encantar clientes"),
      mediaType: "text/plain",
      filename: "brief.txt",
    });
    expect(txt).toMatchObject({ mode: "text" });
    if (txt.mode === "text") expect(txt.text).toContain("Missão");

    const csv = await prepareDocumentContent({
      bytes: enc("campo,valor\npublico,PMEs"),
      mediaType: "text/csv",
      filename: "dados.csv",
    });
    if (csv.mode === "text") expect(csv.text).toContain("PMEs");
    else throw new Error("csv deveria virar texto");
  });

  it("XLSX → texto com abas", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Campo", "Valor"],
        ["Publico", "Gestores de marketing"],
      ]),
      "Briefing",
    );
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const out = await prepareDocumentContent({
      bytes,
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "brief.xlsx",
    });
    expect(out.mode).toBe("text");
    if (out.mode === "text") {
      expect(out.text).toContain("Aba: Briefing");
      expect(out.text).toContain("Gestores de marketing");
    }
  });

  it(".doc legado e formatos binários desconhecidos falham com erro claro", async () => {
    await expect(
      prepareDocumentContent({
        bytes: enc("legacy"),
        mediaType: "application/msword",
        filename: "old.doc",
      }),
    ).rejects.toThrow(/document_format_unsupported/);
    await expect(
      prepareDocumentContent({
        bytes: new Uint8Array([0, 1, 2, 0, 3, 0, 255, 0]),
        mediaType: "application/zip",
        filename: "pack.zip",
      }),
    ).rejects.toThrow(/document_format_unsupported/);
  });

  it("arquivo vazio falha", async () => {
    await expect(
      prepareDocumentContent({
        bytes: new Uint8Array(),
        mediaType: "text/plain",
        filename: "v.txt",
      }),
    ).rejects.toThrow(/document_empty/);
  });
});

describe("mensagens amigáveis", () => {
  it("provider não configurado", () => {
    expect(friendlyAnalysisError(new Error("ai_provider_not_configured: nenhuma IA..."))).toBe(
      "A IA ainda não está configurada para este workspace.",
    );
  });

  it("erro cru do Gemini não vaza para o usuário", () => {
    const raw = new Error(
      "Invalid value at 'contents[0].parts[1].inline_data' (data), Starting an object on a scalar field",
    );
    expect(friendlyAnalysisError(raw)).toMatch(/Não foi possível preparar este arquivo/);
    expect(importErrorMessage(raw)).toMatch(/Não foi possível preparar este arquivo/);
  });

  it("formatos e conteúdo ilegível", () => {
    expect(friendlyAnalysisError(new Error("document_format_unsupported: ..."))).toMatch(
      /Formato não suportado/,
    );
    expect(friendlyAnalysisError(new Error("document_no_text: ..."))).toMatch(/texto legível/);
  });
});

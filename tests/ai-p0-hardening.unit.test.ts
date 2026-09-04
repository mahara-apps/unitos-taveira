import { describe, expect, it } from "vitest";
import { assertFileIntegrity, prepareDocumentContent } from "@/lib/document-extract.server";
import { classifyRunFailure } from "@/lib/briefing-import.server";
import { MODEL_FALLBACKS } from "@/lib/ai-models-catalog.server";

describe("P0 documentos — arquivo corrompido não chega à IA", () => {
  it("PDF sem trailer %%EOF é rejeitado antes de qualquer chamada de modelo", () => {
    const bytes = new Uint8Array(2048);
    bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(() => assertFileIntegrity(bytes, "pdf", "quebrado.pdf")).toThrow(/document_corrupted/);
  });

  it("imagem com assinatura inválida é rejeitada", async () => {
    await expect(
      prepareDocumentContent({
        bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
        mediaType: "image/png",
        filename: "falsa.png",
      }),
    ).rejects.toThrow(/document_corrupted/);
  });

  it("DOCX que não é ZIP é rejeitado", () => {
    expect(() =>
      assertFileIntegrity(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "docx", "ata.docx"),
    ).toThrow(/document_corrupted/);
  });
});

describe("P0 execução assíncrona — falhas de material são terminais", () => {
  it("arquivo corrompido/ilegível vira needs_input (sem retry infinito)", () => {
    for (const msg of [
      "document_corrupted: ata.docx está truncado",
      "document_format_unsupported: envie PDF ou DOCX",
      "document_no_text: a planilha não possui conteúdo legível",
      "document_empty: o arquivo enviado está vazio.",
      "ai_payload_invalid: MIME não suportado inline (application/zip).",
    ]) {
      expect(classifyRunFailure(msg)).toMatchObject({ status: "needs_input", kind: "input" });
    }
  });

  it("falta de provedor/quota continua pausando para intervenção", () => {
    expect(classifyRunFailure("ai_provider_not_configured: nenhuma IA")).toMatchObject({
      status: "paused",
      kind: "provider_blocked",
    });
  });

  it("erro transitório de rede segue elegível a retry", () => {
    expect(classifyRunFailure("fetch failed: ECONNRESET").status).toBe("failed");
  });
});

describe("P0 imagem — modelo padrão do Gemini é o que existe hoje", () => {
  it("gemini-2.5-flash-image é o primeiro candidato (imagen-3 retorna 404)", () => {
    expect(MODEL_FALLBACKS.gemini.image[0]).toBe("gemini-2.5-flash-image");
    expect(MODEL_FALLBACKS.gemini.image).not.toContain("imagen-3.0-generate-002");
  });
});

import { describe, expect, it } from "vitest";
import { detectLinkSource, linkFallbackLabel, normalizeLinkUrl } from "@/lib/link-source";

describe("normalizeLinkUrl", () => {
  it("aceita http(s) e normaliza www", () => {
    expect(normalizeLinkUrl("https://drive.google.com/x")).toBe("https://drive.google.com/x");
    expect(normalizeLinkUrl(" www.figma.com/file/1 ")).toBe("https://www.figma.com/file/1");
  });

  it("rejeita esquemas perigosos ou vazios", () => {
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("")).toBeNull();
    expect(normalizeLinkUrl("não é url")).toBeNull();
  });
});

describe("detectLinkSource", () => {
  it("identifica as principais origens", () => {
    expect(detectLinkSource("https://drive.google.com/file/d/1")).toBe("drive");
    expect(detectLinkSource("https://www.figma.com/file/abc")).toBe("figma");
    expect(detectLinkSource("https://exemplo.com.br/a")).toBe("link");
  });
});

describe("linkFallbackLabel", () => {
  it("usa host + caminho curto quando não há rótulo", () => {
    expect(linkFallbackLabel("https://drive.google.com/folders/x")).toContain("drive.google.com");
  });
});

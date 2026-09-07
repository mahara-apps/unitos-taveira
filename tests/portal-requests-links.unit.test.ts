import { describe, expect, it } from "vitest";
import { detectLinkSource, normalizeLinkUrl } from "@/lib/link-source";
import { MAX_REQUEST_LINKS } from "@/lib/portal-requests.functions";

/**
 * Pedidos do cliente agora aceitam links de referência (Drive, Figma, etc.) e
 * não anexos. Aqui garantimos a mesma normalização usada no servidor.
 */

type LinkIn = { url: string; title?: string };

/** Espelha a normalização de `createPortalRequestFn`. */
function normalizeRequestLinks(input: LinkIn[]) {
  const out: Array<{ url: string; title: string | null; source: string }> = [];
  if (input.length > MAX_REQUEST_LINKS) throw new Error("too_many_links");
  for (const raw of input) {
    const url = normalizeLinkUrl(raw.url);
    if (!url) throw new Error("invalid_link");
    if (out.some((l) => l.url === url)) continue;
    out.push({ url, title: raw.title?.trim() || null, source: detectLinkSource(url) });
  }
  return out;
}

describe("links do pedido do cliente", () => {
  it("reconhece o serviço e mantém o título informado", () => {
    const out = normalizeRequestLinks([
      { url: "drive.google.com/drive/folders/abc", title: "  Pasta da campanha  " },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("https://drive.google.com/drive/folders/abc");
    expect(out[0]!.source).toBe("drive");
    expect(out[0]!.title).toBe("Pasta da campanha");
  });

  it("recusa endereço inválido", () => {
    expect(() => normalizeRequestLinks([{ url: "nao-e-um-link" }])).toThrow("invalid_link");
  });

  it("ignora link repetido", () => {
    const out = normalizeRequestLinks([
      { url: "https://figma.com/file/1" },
      { url: "https://figma.com/file/1" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("respeita o limite de links", () => {
    const many = Array.from({ length: MAX_REQUEST_LINKS + 1 }, (_, i) => ({
      url: `https://drive.google.com/f/${i}`,
    }));
    expect(() => normalizeRequestLinks(many)).toThrow("too_many_links");
  });
});

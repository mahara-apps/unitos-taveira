import { describe, expect, it } from "vitest";

import { renderErrorPage } from "../src/lib/error-page";

describe("renderErrorPage", () => {
  it("renders a recoverable pt-BR fallback", () => {
    const html = renderErrorPage();

    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("Esta página não carregou");
    expect(html).toContain("Tentar novamente");
    expect(html).not.toContain("Referência:");
  });

  it("shows and escapes a safe correlation reference", () => {
    const html = renderErrorPage('abc<123&"');

    expect(html).toContain("Referência:");
    expect(html).toContain("abc&lt;123&amp;&quot;");
    expect(html).not.toContain('abc<123&"');
  });
});
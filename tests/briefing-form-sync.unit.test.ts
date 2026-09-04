import { describe, expect, it } from "vitest";
import { briefingContentSignature, decideBriefingFormSync } from "@/lib/briefing-form-sync";

describe("decideBriefingFormSync", () => {
  it("monta o formulário na primeira carga", () => {
    expect(
      decideBriefingFormSync({
        hasForm: false,
        dirty: false,
        serverVersion: "2026-09-04T10:00:00Z",
        syncedVersion: null,
      }),
    ).toBe("apply");
  });

  it("reflete a versão nova vinda da IA quando não há edição local", () => {
    expect(
      decideBriefingFormSync({
        hasForm: true,
        dirty: false,
        serverVersion: "2026-09-04T11:00:00Z",
        syncedVersion: "2026-09-04T10:00:00Z",
      }),
    ).toBe("apply");
  });

  it("pergunta antes de sobrescrever edições não salvas", () => {
    expect(
      decideBriefingFormSync({
        hasForm: true,
        dirty: true,
        serverVersion: "2026-09-04T11:00:00Z",
        syncedVersion: "2026-09-04T10:00:00Z",
      }),
    ).toBe("prompt");
  });

  it("não remonta o formulário quando a versão é a mesma", () => {
    expect(
      decideBriefingFormSync({
        hasForm: true,
        dirty: true,
        serverVersion: "2026-09-04T10:00:00Z",
        syncedVersion: "2026-09-04T10:00:00Z",
      }),
    ).toBe("keep");
  });
});

describe("briefingContentSignature", () => {
  it("atualiza os campos quando o conteúdo muda com a mesma data (banco sem gatilho)", () => {
    expect(
      decideBriefingFormSync({
        hasForm: true,
        dirty: false,
        serverVersion: "2026-09-04T10:00:00Z",
        syncedVersion: "2026-09-04T10:00:00Z",
        serverSignature: briefingContentSignature({ brand_hub: { produto: "novo" } }),
        syncedSignature: briefingContentSignature({ brand_hub: {} }),
      }),
    ).toBe("apply");
  });

  it("pergunta quando o conteúdo muda e há edição local", () => {
    expect(
      decideBriefingFormSync({
        hasForm: true,
        dirty: true,
        serverVersion: "2026-09-04T10:00:00Z",
        syncedVersion: "2026-09-04T10:00:00Z",
        serverSignature: briefingContentSignature({ a: 1 }),
        syncedSignature: briefingContentSignature({ a: 2 }),
      }),
    ).toBe("prompt");
  });

  it("assinatura independe da ordem das chaves", () => {
    expect(briefingContentSignature({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      briefingContentSignature({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
  });
});

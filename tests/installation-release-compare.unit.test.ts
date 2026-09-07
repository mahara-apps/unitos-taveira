import { describe, expect, it } from "vitest";

import {
  MASTER_RELEASE_VERSION,
  compareReleaseVersions,
  masterNotPublishedMessage,
} from "@/lib/installation/manager-contract";

describe("compareReleaseVersions", () => {
  it("compara numericamente, não como texto", () => {
    expect(compareReleaseVersions("1.3.10", "1.3.9")).toBe(1);
    expect(compareReleaseVersions("1.3.9", "1.3.10")).toBe(-1);
    expect(compareReleaseVersions("1.3.3", "1.3.3")).toBe(0);
    expect(compareReleaseVersions("1.4", "1.3.99")).toBe(1);
  });

  it("não lança com versões não numéricas", () => {
    expect(() => compareReleaseVersions("2026.09.0-rc", "1.3.3")).not.toThrow();
  });

  it("detecta pacote publicado atrasado em relação ao sistema", () => {
    expect(compareReleaseVersions("1.3.1", MASTER_RELEASE_VERSION)).toBeLessThan(0);
  });
});

describe("masterNotPublishedMessage", () => {
  it("explica em português que publicar é o próximo passo", () => {
    const msg = masterNotPublishedMessage("1.3.1", "1.3.3");
    expect(msg).toContain("1.3.1");
    expect(msg).toContain("1.3.3");
    expect(msg.toLowerCase()).toContain("publique o master");
  });
});

import { describe, expect, it } from "vitest";
import { classifyMetaIssue, metaIssueState, metaIssueToast } from "@/lib/meta/issue-messages";

const RAW = [
  "Unsupported get request. Object with ID '123' does not exist",
  "(#4) Application request limit reached",
  "OAuthException: Error validating access token",
];

describe("classificação de falhas da Meta para a UI", () => {
  it("classifica limite temporário como rate_limit", () => {
    expect(classifyMetaIssue("(#4) Application request limit reached")).toBe("rate_limit");
    expect(classifyMetaIssue("Please retry your request later")).toBe("rate_limit");
  });

  it("classifica permissão/autorização corretamente", () => {
    expect(classifyMetaIssue("(#10) does not have permission")).toBe("permission");
    expect(classifyMetaIssue("Unsupported get request")).toBe("permission");
  });

  it("cai em genérico quando não reconhece", () => {
    expect(classifyMetaIssue("Falha desconhecida ao ler payload")).toBe("generic");
  });

  it("rate limit nunca sugere reautorização", () => {
    const s = metaIssueState(["(#4) Application request limit reached"])!;
    expect(s.title).toBe("Sincronização temporariamente limitada");
    expect(s.suggestReauthorize).toBe(false);
    expect(s.allowRetry).toBe(true);
  });

  it("permissão sugere reautorização", () => {
    const s = metaIssueState([null, "(#200) permission missing"])!;
    expect(s.title).toBe("Algumas contas precisam de atenção");
    expect(s.suggestReauthorize).toBe(true);
  });

  it("rate limit domina quando há mensagens mistas", () => {
    expect(metaIssueState(["Unsupported get request", "(#4) request limit reached"])!.kind).toBe(
      "rate_limit",
    );
  });

  it("sem mensagens não há alerta", () => {
    expect(metaIssueState([null, "", undefined])).toBeNull();
  });

  it("nenhum texto técnico cru vaza para título/resumo/toast", () => {
    const forbidden = [/Unsupported get request/i, /request limit reached/i, /\(#\d+\)/, /OAuth/i];
    for (const raw of RAW) {
      const s = metaIssueState([raw])!;
      const t = metaIssueToast(raw);
      for (const text of [s.title, s.summary, s.recommendation, t.title, t.description]) {
        for (const re of forbidden) expect(text).not.toMatch(re);
      }
    }
  });
});

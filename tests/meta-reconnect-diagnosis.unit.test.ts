import { describe, expect, it } from "vitest";
import {
  classifyReconnectFailure,
  maskId,
  reconnectDiagnosis,
} from "@/lib/meta/reconnect-diagnosis";

describe("diagnóstico de reconexão Meta", () => {
  it("cenário 1: (#100) campo inexistente é consulta inválida, não permissão", () => {
    const kind = classifyReconnectFailure(
      "Tried accessing nonexistent field (instagram_business_account) on node type (IGUser)",
      { code: 100 },
      400,
    );
    expect(kind).toBe("unsupported");
    const d = reconnectDiagnosis(kind);
    // Nunca oferecer "Nova autorização" como resposta a erro de campo.
    expect(d.allowReauthorize).toBe(false);
    expect(d.allowRetry).toBe(true);
  });

  it("permissão/token expirado permite reautorizar", () => {
    expect(classifyReconnectFailure("Invalid OAuth access token", { code: 190 }, 401)).toBe(
      "permission",
    );
    expect(reconnectDiagnosis("permission").allowReauthorize).toBe(true);
  });

  it("conta inexistente é not_found", () => {
    expect(
      classifyReconnectFailure("Object with ID '123' does not exist", { code: 803 }, 404),
    ).toBe("not_found");
  });

  it("limite temporário não sugere reautorização", () => {
    const d = reconnectDiagnosis(
      classifyReconnectFailure("Application request limit reached", { code: 4 }),
    );
    expect(d.kind).toBe("rate_limit");
    expect(d.allowReauthorize).toBe(false);
  });

  it("instagram sem vínculo é not_linked e não pede reautorização", () => {
    const d = reconnectDiagnosis("not_linked");
    expect(d.allowReauthorize).toBe(false);
    expect(d.action).toMatch(/vincule/i);
  });

  it("cenário 2: divergência de identidade não sugere reautorização e exige confirmação", () => {
    const d = reconnectDiagnosis("identity_mismatch");
    expect(d.badge).toBe("Conta diferente");
    expect(d.allowReauthorize).toBe(false);
    expect(d.action).toMatch(/sem a sua confirmação/i);
  });

  it("todo diagnóstico tem problema, causa e ação sem texto técnico cru", () => {
    const kinds = [
      "ok",
      "identity_mismatch",
      "permission",
      "not_linked",
      "unsupported",
      "not_found",
      "rate_limit",
      "generic",
    ] as const;
    for (const k of kinds) {
      const d = reconnectDiagnosis(k);
      for (const text of [d.title, d.cause, d.action, d.badge]) {
        expect(text.length).toBeGreaterThan(2);
        expect(text).not.toMatch(/\(#\d+\)|graph\.facebook|nonexistent field|http/i);
      }
    }
  });

  it("IDs são mascarados mantendo conferência humana", () => {
    expect(maskId("17841400000000000")).toBe("1784••••0000");
    expect(maskId(null)).toBe("—");
    expect(maskId("12345")).toBe("12345");
  });
});

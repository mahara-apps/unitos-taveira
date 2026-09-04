import { describe, expect, it } from "vitest";
import {
  authChecklist,
  authProgress,
  busyChannel,
  classifyConnectFailure,
  connectErrorCopy,
  connectStepIndex,
  isConnectBusy,
  readAuthorizeUrl,
  type MetaConnectState,
} from "../src/lib/meta/connect-flow";

const err = (reason: Parameters<typeof connectErrorCopy>[0]): MetaConnectState => ({
  kind: "error",
  channel: "facebook",
  reason,
});

describe("readAuthorizeUrl", () => {
  it("aceita URL válida", () => {
    expect(readAuthorizeUrl({ authorizeUrl: " https://facebook.com/x " })).toBe(
      "https://facebook.com/x",
    );
  });
  it("erro legível para retorno indefinido", () => {
    expect(() => readAuthorizeUrl(undefined)).toThrow(/dados de autorização/i);
  });
  it("erro legível quando falta authorizeUrl", () => {
    expect(() => readAuthorizeUrl({ redirectUri: "x" })).toThrow(/endereço de autorização/i);
  });
  it("erro legível quando authorizeUrl é vazio", () => {
    expect(() => readAuthorizeUrl({ authorizeUrl: "  " })).toThrow(/endereço de autorização/i);
  });
});

describe("progresso real da autorização", () => {
  it("starting não marca nenhum passo como concluído", () => {
    const items = authChecklist({ kind: "starting", channel: "facebook" });
    expect(items.filter((i) => i.state === "done")).toHaveLength(0);
    expect(items[0]?.state).toBe("current");
    expect(authProgress({ kind: "starting", channel: "facebook" })).toBe(0);
  });
  it("awaiting para no passo de consentimento", () => {
    const items = authChecklist({ kind: "awaiting", channel: "facebook" });
    expect(items[2]?.state).toBe("current");
    expect(items[3]?.state).toBe("pending");
  });
  it("authorized conclui tudo", () => {
    const s: MetaConnectState = { kind: "authorized", channel: "instagram", sessionId: "s" };
    expect(authProgress(s)).toBe(100);
    expect(connectStepIndex(s)).toBe(1);
  });
  it("erro marca o passo que falhou e nunca fica em loading", () => {
    expect(authChecklist(err("missing_url"))[0]?.state).toBe("error");
    expect(authChecklist(err("cancelled"))[2]?.state).toBe("error");
    for (const state of [
      err("timeout"),
      err("rate_limit"),
      err("permission"),
      err("popup_blocked"),
    ]) {
      expect(authChecklist(state).some((i) => i.state === "current")).toBe(false);
      expect(isConnectBusy(state)).toBe(false);
    }
  });
});

describe("estados terminais e cópias", () => {
  it("todo estado ocupado expõe canal e todo estado terminal não", () => {
    expect(busyChannel({ kind: "awaiting", channel: "facebook" })).toBe("facebook");
    expect(busyChannel({ kind: "idle" })).toBeNull();
    expect(busyChannel(err("timeout"))).toBeNull();
  });
  it("rate limit é atenção, não falha fatal", () => {
    const copy = connectErrorCopy("rate_limit");
    expect(copy.severity).toBe("warning");
    expect(copy.action).toBe("retry");
  });
  it("permissão sugere reautorizar", () => {
    expect(connectErrorCopy("permission").action).toBe("reauthorize");
  });
});

describe("classificação de falhas", () => {
  it("rate limit #4", () => {
    expect(classifyConnectFailure("(#4) Application request limit reached")).toBe("rate_limit");
  });
  it("permissão", () => {
    expect(classifyConnectFailure("Unsupported get request: owned_instagram_accounts")).toBe(
      "permission",
    );
  });
  it("cancelamento/negação", () => {
    expect(classifyConnectFailure("access_denied")).toBe("denied");
  });
  it("desconhecido", () => {
    expect(classifyConnectFailure("boom")).toBe("unknown");
    expect(classifyConnectFailure(null)).toBe("unknown");
  });
});

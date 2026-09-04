import { describe, expect, it } from "vitest";
import { isNonRetriableQueryError, resolveScreenQueryState } from "@/lib/screen-query-state";
import { QueryTimeoutError, withQueryTimeout } from "@/lib/query-timeout";

const base = {
  sessionReady: true,
  isFetching: false,
  isError: false,
  hasData: false,
  isSuccess: false,
};

describe("Dashboard: nenhum fluxo pode ficar em skeleton", () => {
  it("entrada direta / primeira carga sem cache → loading e depois ready", () => {
    expect(resolveScreenQueryState({ ...base, isFetching: true })).toBe("loading");
    expect(resolveScreenQueryState({ ...base, hasData: true, isSuccess: true })).toBe("ready");
  });

  it("identidade ainda resolvendo (F5) → loading, nunca estado morto", () => {
    expect(resolveScreenQueryState({ ...base, sessionReady: false })).toBe("loading");
  });

  it("timeout da query → estado terminal de erro", () => {
    expect(resolveScreenQueryState({ ...base, isError: true })).toBe("error");
  });

  it("erro 500 e erro de permissão sem cache → erro terminal", () => {
    expect(resolveScreenQueryState({ ...base, isError: true, isFetching: true })).toBe("error");
  });

  it("sucesso sem payload → vazio terminal (não skeleton)", () => {
    expect(resolveScreenQueryState({ ...base, isSuccess: true })).toBe("empty");
  });

  it("query nunca disparada com sessão pronta → vazio terminal", () => {
    expect(resolveScreenQueryState(base)).toBe("empty");
  });

  it("cache visível durante atualização → refreshing, nunca skeleton", () => {
    expect(resolveScreenQueryState({ ...base, hasData: true, isFetching: true })).toBe(
      "refreshing",
    );
  });

  it("falha na atualização com cache → mantém tela e avisa", () => {
    expect(
      resolveScreenQueryState({ ...base, hasData: true, isSuccess: true, isError: true }),
    ).toBe("stale-error");
  });

  it("troca de cliente (chave nova, sem cache, fetch ativo) → loading limitado", () => {
    const s = resolveScreenQueryState({ ...base, isFetching: true });
    expect(s).toBe("loading");
    // e ao terminar em falha, encerra em erro acionável
    expect(resolveScreenQueryState({ ...base, isError: true })).toBe("error");
  });
});

describe("retry", () => {
  it("timeout, 401/403 e RLS não são retentados", () => {
    expect(isNonRetriableQueryError(new QueryTimeoutError("X"))).toBe(true);
    expect(isNonRetriableQueryError(new Error("permission denied for table brands"))).toBe(true);
    expect(isNonRetriableQueryError(new Error("Unauthorized"))).toBe(true);
    expect(isNonRetriableQueryError(new Error("new row violates row-level security"))).toBe(true);
  });

  it("erro de rede/500 continua retentável", () => {
    expect(isNonRetriableQueryError(new Error("Internal Server Error"))).toBe(false);
    expect(isNonRetriableQueryError(new Error("fetch failed"))).toBe(false);
  });

  it("query pendurada vira erro terminal por timeout", async () => {
    await expect(withQueryTimeout(new Promise<never>(() => {}), "X", 20)).rejects.toBeInstanceOf(
      QueryTimeoutError,
    );
  });
});

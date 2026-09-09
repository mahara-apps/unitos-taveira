import { describe, expect, it } from "vitest";

import { deltaProgressKey, UPDATE_DELTA_LABEL } from "@/lib/installation/automation.server";

/**
 * Regressão: um provisionamento antigo marcava "007_delta_migrations" como
 * aplicado. Quando o MASTER publicava um pacote novo, o checkpoint antigo fazia
 * o delta ser PULADO e a validação final acusava colunas/tabelas ausentes.
 */
describe("checkpoint do pacote MASTER", () => {
  it("a chave do checkpoint muda quando o conteúdo do pacote muda", () => {
    const a = deltaProgressKey("create table a();");
    const b = deltaProgressKey("create table a(); create table b();");
    expect(a).not.toBe(b);
    expect(a.startsWith(`${UPDATE_DELTA_LABEL}:`)).toBe(true);
  });

  it("o mesmo pacote gera a mesma chave (retomada continua do ponto certo)", () => {
    expect(deltaProgressKey("select 1;")).toBe(deltaProgressKey("select 1;"));
  });
});

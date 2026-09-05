import { describe, expect, it } from "vitest";
import {
  displayName,
  identityLabel,
  initialsOf,
  isTestIdentity,
  nameFromEmail,
  needsRealName,
} from "@/lib/identity";

describe("identidade exibida", () => {
  it("usa o nome informado quando existe", () => {
    expect(displayName({ full_name: "Maria Souza", email: "m@x.com" })).toBe("Maria Souza");
  });

  it("deriva nome apresentável do e-mail", () => {
    expect(nameFromEmail("joao.silva+tag@x.com")).toBe("Joao Silva");
    expect(displayName({ full_name: null, email: "ana_paula@x.com" })).toBe("Ana Paula");
  });

  it("cai para 'Sem nome' quando não há nada útil", () => {
    expect(displayName({ full_name: null, email: null })).toBe("Sem nome");
  });

  it("mostra e-mail ao lado para distinguir homônimos", () => {
    expect(identityLabel({ full_name: "Maria Souza", email: "maria@x.com" })).toBe(
      "Maria Souza · maria@x.com",
    );
  });

  it("gera iniciais de até duas letras", () => {
    expect(initialsOf({ full_name: "Maria Souza", email: null })).toBe("MS");
    expect(initialsOf({ full_name: null, email: null })).toBe("?");
  });

  it("reconhece contas de teste automatizado", () => {
    expect(isTestIdentity("qa+1@unitos-tests.dev")).toBe(true);
    expect(isTestIdentity("jose@mahara.marketing")).toBe(false);
  });

  it("exige nome real no primeiro acesso", () => {
    expect(needsRealName({ full_name: null })).toBe(true);
    expect(needsRealName({ full_name: "Maria" })).toBe(true);
    expect(needsRealName({ full_name: "Maria Souza" })).toBe(false);
  });
});

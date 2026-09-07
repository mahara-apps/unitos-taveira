import { describe, expect, it, beforeAll } from "vitest";
import { aiErrorMessage } from "@/lib/ai-error-display";

describe("credenciais ilegíveis", () => {
  beforeAll(() => {
    process.env.BRAND_CREDENTIALS_SECRET = "segredo-a";
  });

  it("decryptCredential lança erro de domínio quando o segredo muda", async () => {
    const mod = await import("@/lib/credentials-crypto.server");
    const stored = await mod.encryptCredential("minha-chave");
    expect(await mod.decryptCredential(stored)).toBe("minha-chave");

    process.env.BRAND_CREDENTIALS_SECRET = "segredo-b";
    await expect(mod.decryptCredential(stored)).rejects.toSatisfy((err: unknown) =>
      mod.isCredentialDecryptError(err),
    );
    process.env.BRAND_CREDENTIALS_SECRET = "segredo-a";
  });

  it("mensagem crua do WebCrypto vira instrução acionável", () => {
    const msg = aiErrorMessage(
      new Error("The operation failed for an operation-specific reason"),
      "fallback",
    );
    expect(msg).toContain("Salve a chave do provedor novamente");
  });

  it("remove prefixo técnico das mensagens de provedor", () => {
    expect(aiErrorMessage(new Error("ai_provider_key_unreadable:gemini: chave ilegível"), "x")).toBe(
      "chave ilegível",
    );
  });
});

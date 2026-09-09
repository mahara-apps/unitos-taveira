import { describe, expect, it } from "vitest";
import {
  BUILD_MAX_MINUTES,
  isGitOnlyOrMissingRepo,
  parseDeployQuotaError,
} from "@/lib/installation/automation.server";

describe("parseDeployQuotaError", () => {
  it("reconhece o limite diário do plano gratuito da Vercel", () => {
    const body = JSON.stringify({
      error: {
        code: "payment_required",
        message: 'Resource is limited (more than 100, code: "api-deployments-free-per-day").',
        limit: { total: 100, remaining: 0, reset: 1788631900 },
      },
    });
    const parsed = parseDeployQuotaError(402, body);
    expect(parsed.quotaExceeded).toBe(true);
    expect(parsed.resetAt).toBe(1788631900);
  });

  it("não confunde outros erros com cota", () => {
    expect(parseDeployQuotaError(400, '{"error":{"code":"invalid_request"}}').quotaExceeded).toBe(
      false,
    );
  });
});

describe("isGitOnlyOrMissingRepo", () => {
  it("reconhece a política 'somente Git em produção' como recusa terminal", () => {
    expect(
      isGitOnlyOrMissingRepo(
        "REST API deployments are not allowed in production. Only Git deployments are allowed.",
      ),
    ).toBe(true);
  });

  it("reconhece repositório não resolvido pela API", () => {
    expect(isGitOnlyOrMissingRepo('{"error":{"code":"incorrect_git_source_info"}}')).toBe(true);
  });

  it("não confunde erros comuns com recusa", () => {
    expect(isGitOnlyOrMissingRepo('{"error":{"code":"invalid_request"}}')).toBe(false);
    expect(isGitOnlyOrMissingRepo("")).toBe(false);
  });
});

describe("BUILD_MAX_MINUTES", () => {
  it("tem teto absoluto para a publicação", () => {
    expect(BUILD_MAX_MINUTES).toBeGreaterThan(0);
    expect(BUILD_MAX_MINUTES).toBeLessThanOrEqual(30);
  });
});

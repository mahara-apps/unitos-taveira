import { describe, expect, it } from "vitest";
import { parseDeployQuotaError } from "@/lib/installation/automation.server";

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
    expect(parseDeployQuotaError(400, '{"error":{"code":"invalid_request"}}').quotaExceeded).toBe(false);
  });
});

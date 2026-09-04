import { describe, expect, it, vi } from "vitest";
import {
  briefingVersionFromSources,
  resolvePlanBriefingVersion,
} from "../src/lib/monthly-plan-briefing.server";

function scopedClient(row: { id: string } | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error });
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return { client: { from: vi.fn().mockReturnValue(chain) }, chain };
}

describe("monthly plan briefing reference", () => {
  it("keeps the current version in context sources", () => {
    expect(briefingVersionFromSources({ briefing_version_id: "version-1" })).toBe("version-1");
    expect(briefingVersionFromSources({ briefing_version_id: 123 })).toBeNull();
    expect(briefingVersionFromSources(null)).toBeNull();
  });

  it("accepts a version only in the requested brand and client scope", async () => {
    const { client, chain } = scopedClient({ id: "version-1" });
    await expect(
      resolvePlanBriefingVersion(client as never, {
        briefingVersionId: "version-1",
        brandId: "brand-1",
        clientId: "client-1",
      }),
    ).resolves.toBe("version-1");
    expect(chain.eq).toHaveBeenNthCalledWith(1, "id", "version-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "brand_id", "brand-1");
    expect(chain.eq).toHaveBeenNthCalledWith(3, "client_id", "client-1");
  });

  it("rejects a missing or out-of-scope version", async () => {
    const { client } = scopedClient(null);
    await expect(
      resolvePlanBriefingVersion(client as never, {
        briefingVersionId: "other-version",
        brandId: "brand-1",
        clientId: "client-1",
      }),
    ).rejects.toThrow("briefing_version_invalid");
  });

  it("does not query when no specific version was selected", async () => {
    const { client } = scopedClient(null);
    await expect(
      resolvePlanBriefingVersion(client as never, {
        briefingVersionId: null,
        brandId: "brand-1",
        clientId: "client-1",
      }),
    ).resolves.toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });
});
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/credentials-crypto.server", () => ({
  decryptCredential: async () => "page-token",
}));

import {
  MetaPublishingService,
  SUPPORTED_PLACEMENTS,
  assertSupported,
} from "@/lib/meta/publishing.server";
import { isActiveDestConflict, describeQueueInsertError } from "@/lib/social/queue-conflict";

type Call = { path: string; opts: { method?: string; query?: Record<string, string> } };

function fakeProvider(statusSequence: string[]) {
  const calls: Call[] = [];
  let statusIdx = 0;
  const provider = {
    graph: async (path: string, opts: any) => {
      calls.push({ path, opts });
      if (path.endsWith("/media")) return { id: "container-1" };
      if (path.endsWith("/media_publish")) return { id: "media-1" };
      if (path === "/container-1") {
        const code = statusSequence[Math.min(statusIdx, statusSequence.length - 1)];
        statusIdx += 1;
        return { status_code: code };
      }
      return { permalink: "https://instagram.com/p/x" };
    },
  };
  return { provider, calls };
}

const connection = {
  id: "c1",
  provider: "meta",
  external_id: "page-1",
  account_id: "ig-1",
  access_token_ciphertext: "cipher",
};

describe("Reels no Instagram", () => {
  it("expõe instagram_reels como placement suportado", () => {
    expect(SUPPORTED_PLACEMENTS).toContain("instagram_reels");
    expect(() => assertSupported("instagram_reels")).not.toThrow();
    expect(() => assertSupported("facebook_reels")).toThrow();
  });

  it("cria container REELS com vídeo, aguarda FINISHED e publica", async () => {
    const { provider, calls } = fakeProvider(["IN_PROGRESS", "FINISHED"]);
    const svc = new MetaPublishingService(provider as never);
    const res = await svc.publish(connection as never, {
      placement: "instagram_reels",
      caption: "legenda",
      media: { videoUrl: "https://cdn/x.mp4" },
    });
    expect(res.externalPostId).toBe("media-1");
    const container = calls.find((c) => c.path === "/ig-1/media")!;
    expect(container.opts.query?.media_type).toBe("REELS");
    expect(container.opts.query?.video_url).toBe("https://cdn/x.mp4");
    expect(container.opts.query?.share_to_feed).toBe("true");
    expect(calls.some((c) => c.path === "/container-1")).toBe(true);
    expect(calls.some((c) => c.path === "/ig-1/media_publish")).toBe(true);
  });

  it("recusa Reels sem vídeo com mensagem em pt-BR", async () => {
    const { provider } = fakeProvider(["FINISHED"]);
    const svc = new MetaPublishingService(provider as never);
    await expect(
      svc.publish(connection as never, {
        placement: "instagram_reels",
        media: { imageUrl: "https://cdn/x.jpg" },
      }),
    ).rejects.toThrow(/Reels exige um vídeo/i);
  });

  it("falha quando a Meta reporta ERROR no processamento do vídeo", async () => {
    const { provider } = fakeProvider(["ERROR"]);
    const svc = new MetaPublishingService(provider as never);
    await expect(
      svc.publish(connection as never, {
        placement: "instagram_reels",
        media: { videoUrl: "https://cdn/x.mp4" },
      }),
    ).rejects.toThrow(/recusou a mídia/i);
  });

  it("nunca publica container que não terminou o processamento", async () => {
    const { provider, calls } = fakeProvider(["IN_PROGRESS"]);
    const svc = new MetaPublishingService(provider as never);
    const spy = svc as unknown as {
      waitForContainerReady: (id: string, t: string, o?: unknown) => Promise<void>;
    };
    await expect(spy.waitForContainerReady("container-1", "tok", { attempts: 2, intervalMs: 0 }))
      .rejects.toThrow(/ainda está sendo processada/i);
    expect(calls.some((c) => c.path === "/ig-1/media_publish")).toBe(false);
  });
});

describe("conflito de fila de publicação", () => {
  it("detecta o conflito de destino ativo", () => {
    expect(
      isActiveDestConflict('duplicate key value violates unique constraint "social_posts_active_dest_key"'),
    ).toBe(true);
    expect(isActiveDestConflict("outro erro")).toBe(false);
  });

  it("traduz o erro técnico para linguagem operacional", () => {
    const msg = describeQueueInsertError(
      'duplicate key value violates unique constraint "social_posts_active_dest_key"',
      "instagram",
      "reels",
    );
    expect(msg).toMatch(/Instagram/);
    expect(msg).toMatch(/aguardando nova tentativa/i);
    expect(describeQueueInsertError("erro qualquer", "instagram", "feed")).toBe("erro qualquer");
  });
});

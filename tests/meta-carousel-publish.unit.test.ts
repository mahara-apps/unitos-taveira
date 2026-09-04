import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/credentials-crypto.server", () => ({
  decryptCredential: async () => "page-token",
}));

import {
  MetaPublishingService,
  SUPPORTED_PLACEMENTS,
  assertSupported,
  assertCarouselItems,
} from "@/lib/meta/publishing.server";

type Call = { path: string; opts: { method?: string; query?: Record<string, string> } };

function fakeProvider() {
  const calls: Call[] = [];
  let childSeq = 0;
  const provider = {
    graph: async (path: string, opts: any) => {
      calls.push({ path, opts });
      if (path.endsWith("/media")) {
        if (opts?.query?.media_type === "CAROUSEL") return { id: "parent-1" };
        childSeq += 1;
        return { id: `child-${childSeq}` };
      }
      if (path.endsWith("/media_publish")) return { id: "media-1" };
      if (path.endsWith("/photos")) {
        childSeq += 1;
        return { id: `photo-${childSeq}` };
      }
      if (path.endsWith("/feed")) return { id: "page-1_999" };
      if (path.startsWith("/child-") || path === "/parent-1") return { status_code: "FINISHED" };
      return { permalink: "https://instagram.com/p/x" };
    },
  };
  return { provider, calls };
}

const igConnection = {
  id: "c1",
  provider: "meta",
  channel: "instagram",
  external_id: "page-1",
  account_id: "ig-1",
  access_token_ciphertext: "cipher",
};

const fbConnection = { ...igConnection, channel: "facebook", account_id: null };

describe("Carrossel Meta", () => {
  it("expõe placements de carrossel como suportados", () => {
    expect(SUPPORTED_PLACEMENTS).toContain("instagram_carousel");
    expect(SUPPORTED_PLACEMENTS).toContain("facebook_carousel");
    expect(() => assertSupported("instagram_carousel")).not.toThrow();
  });

  it("valida limites de 2 a 10 mídias em pt-BR", () => {
    expect(() => assertCarouselItems([{ imageUrl: "a" }])).toThrow(/pelo menos 2/);
    expect(() =>
      assertCarouselItems(Array.from({ length: 11 }, (_, i) => ({ imageUrl: `i${i}` }))),
    ).toThrow(/no máximo 10/);
    expect(assertCarouselItems([{ imageUrl: "a" }, { imageUrl: "b" }])).toHaveLength(2);
  });

  it("Instagram: cria containers-filhos, container-pai CAROUSEL e publica", async () => {
    const { provider, calls } = fakeProvider();
    const svc = new MetaPublishingService(provider as never);
    const res = await svc.publish(igConnection as never, {
      placement: "instagram_carousel",
      caption: "legenda",
      media: { items: [{ imageUrl: "https://cdn/1.jpg" }, { imageUrl: "https://cdn/2.jpg" }] },
    });
    expect(res.externalPostId).toBe("media-1");
    const children = calls.filter(
      (c) => c.path === "/ig-1/media" && c.opts.query?.is_carousel_item === "true",
    );
    expect(children).toHaveLength(2);
    const parent = calls.find((c) => c.opts.query?.media_type === "CAROUSEL")!;
    expect(parent.opts.query?.children).toBe("child-1,child-2");
    expect(parent.opts.query?.caption).toBe("legenda");
    expect(calls.some((c) => c.path === "/ig-1/media_publish")).toBe(true);
  });

  it("Facebook: envia fotos não publicadas e cria post com attached_media", async () => {
    const { provider, calls } = fakeProvider();
    const svc = new MetaPublishingService(provider as never);
    const res = await svc.publish(fbConnection as never, {
      placement: "facebook_carousel",
      caption: "álbum",
      media: { items: [{ imageUrl: "https://cdn/1.jpg" }, { imageUrl: "https://cdn/2.jpg" }] },
    });
    expect(res.externalPostId).toBe("page-1_999");
    const photos = calls.filter((c) => c.path === "/page-1/photos");
    expect(photos).toHaveLength(2);
    expect(photos[0]!.opts.query?.published).toBe("false");
    const feed = calls.find((c) => c.path === "/page-1/feed")!;
    expect(feed.opts.query?.["attached_media[0]"]).toBe(JSON.stringify({ media_fbid: "photo-1" }));
    expect(feed.opts.query?.["attached_media[1]"]).toBe(JSON.stringify({ media_fbid: "photo-2" }));
  });

  it("Facebook: recusa vídeo no carrossel com mensagem em pt-BR", async () => {
    const { provider } = fakeProvider();
    const svc = new MetaPublishingService(provider as never);
    await expect(
      svc.publish(fbConnection as never, {
        placement: "facebook_carousel",
        media: { items: [{ imageUrl: "https://cdn/1.jpg" }, { videoUrl: "https://cdn/2.mp4" }] },
      }),
    ).rejects.toThrow(/apenas imagens/);
  });
});

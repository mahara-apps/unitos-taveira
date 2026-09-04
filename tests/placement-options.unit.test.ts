import { describe, expect, it } from "vitest";
import {
  countPlacementOptions,
  hasPlacementOptions,
  normalizePlacementOptions,
  optionsForDestination,
} from "@/lib/placement-options";

describe("opções avançadas por destino", () => {
  it("expõe apenas opções válidas para o destino", () => {
    expect(optionsForDestination("instagram", "stories")).toEqual([
      "storyMention",
      "paidPartnership",
      "altText",
    ]);
    expect(optionsForDestination("instagram", "reels")).toContain("shareToFeed");
    expect(optionsForDestination("linkedin", "feed")).toEqual([]);
  });

  it("descarta chaves fora da matriz do destino", () => {
    const out = normalizePlacementOptions("instagram", "stories", {
      storyMention: "@marca",
      firstComment: "não vale aqui",
    });
    expect(out).toEqual({ storyMention: "@marca" });
  });

  it("normaliza listas removendo @, vazios e duplicados", () => {
    const out = normalizePlacementOptions("instagram", "feed", {
      collaborators: ["@a", "a", " @b ", ""],
    });
    expect(out.collaborators).toEqual(["a", "b"]);
  });

  it("aceita booleanos apenas quando realmente booleanos", () => {
    expect(normalizePlacementOptions("instagram", "reels", { shareToFeed: false })).toEqual({
      shareToFeed: false,
    });
    expect(normalizePlacementOptions("instagram", "reels", { shareToFeed: "sim" })).toEqual({});
  });

  it("conta e detecta opções preenchidas", () => {
    const opts = normalizePlacementOptions("instagram", "feed", {
      firstComment: "oi",
      collaborators: ["@x"],
    });
    expect(hasPlacementOptions(opts)).toBe(true);
    expect(countPlacementOptions(opts)).toBe(2);
    expect(hasPlacementOptions({})).toBe(false);
  });
});

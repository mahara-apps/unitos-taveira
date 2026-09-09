import { describe, expect, it } from "vitest";
import {
  pairHint,
  pairedInstagramOf,
  selectionEntriesFromLinked,
  unlinkTargets,
} from "../src/lib/meta/link-pair";

const page = {
  pageId: "100",
  pageName: "Taveira",
  instagramBusinessId: "ig-1",
  instagramUsername: "taveira",
};
const pageWithoutIg = { pageId: "200", pageName: "Sem IG", instagramBusinessId: null };

describe("vínculo em par da Meta", () => {
  it("Página e Instagram entram juntos na bandeja de conclusão", () => {
    const entries = selectionEntriesFromLinked(
      [
        { channel: "facebook", externalId: "100", connectionId: "c-fb", label: "Taveira" },
        { channel: "instagram", externalId: "ig-1", connectionId: "c-ig", label: "taveira" },
      ],
      [page],
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      channel: "instagram",
      targetId: "100",
      lookupId: "ig-1",
      connectionId: "c-ig",
    });
  });

  it("Instagram avulso do portfólio mantém o próprio id como linha", () => {
    const entries = selectionEntriesFromLinked(
      [{ channel: "instagram", externalId: "ig-solo", connectionId: "c", label: "solo" }],
      [],
    );
    expect(entries[0]).toMatchObject({ targetId: "ig-solo", lookupId: "ig-solo" });
  });

  it("desativar a Página remove o Instagram do mesmo par", () => {
    const removals = unlinkTargets({
      channel: "facebook",
      page,
      connected: { facebook: { "100": "c-fb" }, instagram: { "ig-1": "c-ig" } },
    });
    expect(removals.map((r) => r.connectionId)).toEqual(["c-fb", "c-ig"]);
  });

  it("Página sem Instagram remove apenas a Página", () => {
    const removals = unlinkTargets({
      channel: "facebook",
      page: pageWithoutIg,
      connected: { facebook: { "200": "c-fb" }, instagram: {} },
    });
    expect(removals).toHaveLength(1);
  });

  it("desativar o Instagram não mexe na Página", () => {
    const removals = unlinkTargets({
      channel: "instagram",
      page,
      connected: { facebook: { "100": "c-fb" }, instagram: { "ig-1": "c-ig" } },
    });
    expect(removals).toHaveLength(0);
  });

  it("explica o par e a ausência de Instagram", () => {
    expect(pairedInstagramOf(page)).toEqual({ id: "ig-1", username: "taveira" });
    expect(pairHint(page)).toContain("@taveira");
    expect(pairHint(pageWithoutIg)).toContain("Sem Instagram Business");
  });
});

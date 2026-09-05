import { describe, expect, it } from "vitest";
import { resolveMentions } from "../src/components/ui/mention-textarea";
import { notifyMentions } from "../src/lib/mention-notify.server";

const people = [
  { id: "u1", name: "Ana Paula" },
  { id: "u2", name: "Bruno Lima" },
];

describe("resolveMentions", () => {
  it("extrai apenas quem está citado no texto", () => {
    expect(resolveMentions("oi @Ana Paula, veja isso", people)).toEqual(["u1"]);
  });

  it("não retorna nada quando a menção foi apagada", () => {
    expect(resolveMentions("oi, veja isso", people)).toEqual([]);
  });

  it("não duplica a mesma pessoa", () => {
    expect(resolveMentions("@Ana Paula e @ana paula", people)).toEqual(["u1"]);
  });
});

function clientWithMembers(members: string[], inserted: unknown[]) {
  return {
    from: (table: string) => {
      if (table === "brand_members") {
        return {
          select: () => ({
            eq: () => ({
              in: (_c: string, ids: string[]) => ({
                data: ids.filter((i) => members.includes(i)).map((user_id) => ({ user_id })),
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        insert: (rows: unknown) => {
          inserted.push(rows);
          return { error: null };
        },
      };
    },
  };
}

describe("notifyMentions", () => {
  const base = {
    brandId: "b1",
    authorId: "u1",
    commentId: "c1",
    title: "Você foi mencionado",
    body: "texto",
    href: "/projects/p1",
  };

  it("notifica apenas membros do workspace e ignora o autor", async () => {
    const inserted: unknown[] = [];
    const client = clientWithMembers(["u1", "u2"], inserted);
    const n = await notifyMentions(client, { ...base, mentions: ["u1", "u2", "u9"] });
    expect(n).toBe(1);
    const rows = inserted[0] as Array<{ user_id: string; kind: string; dedupe_key: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe("u2");
    expect(rows[0]!.kind).toBe("mention");
    expect(rows[0]!.dedupe_key).toBe("mention:c1:u2");
  });

  it("não insere nada quando ninguém elegível", async () => {
    const inserted: unknown[] = [];
    const client = clientWithMembers(["u1"], inserted);
    expect(await notifyMentions(client, { ...base, mentions: ["u1"] })).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

describe("menções com token estável", () => {
  const people = [
    { id: "11111111-1111-1111-1111-111111111111", name: "Maria Souza", email: "maria@x.com" },
    { id: "22222222-2222-2222-2222-222222222222", name: "Maria Souza", email: "maria2@x.com" },
  ];

  it("resolve a pessoa exata pelo token", () => {
    const ids = resolveMentions(
      "oi @[Maria Souza](22222222-2222-2222-2222-222222222222) veja",
      people,
    );
    expect(ids).toEqual(["22222222-2222-2222-2222-222222222222"]);
  });

  it("ignora menção legada ambígua entre homônimos", () => {
    expect(resolveMentions("oi @Maria Souza", people)).toEqual([]);
  });
});

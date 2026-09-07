import { describe, expect, it } from "vitest";

import {
  computeActivitySummary,
  dayKey,
  ipPrefix,
  parseUserAgent,
  summarizeByPerson,
  toCsv,
  type LoginEventRow,
} from "@/lib/login-audit";

const TZ = "America/Sao_Paulo";

function ev(partial: Partial<LoginEventRow>): LoginEventRow {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: "u1",
    brand_id: "b1",
    client_id: null,
    kind: "team",
    event: "sign_in",
    provider: "password",
    email: "ana@x.com",
    device: "Computador",
    os: "macOS",
    browser: "Chrome",
    city: "São Paulo",
    country: "BR",
    created_at: new Date().toISOString(),
    person_name: "Ana",
    person_email: "ana@x.com",
    client_name: null,
    ...partial,
  };
}

describe("parseUserAgent", () => {
  it("identifica iPhone/Safari como celular", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    );
    expect(r).toEqual({ device: "Celular", os: "iOS", browser: "Safari" });
  });

  it("prioriza Edge sobre Chrome/Safari", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120",
    );
    expect(r).toEqual({ device: "Computador", os: "Windows", browser: "Edge" });
  });

  it("trata ausência de user agent", () => {
    expect(parseUserAgent(null).device).toBe("Desconhecido");
  });
});

describe("ipPrefix", () => {
  it("reduz IPv4 a dois blocos", () => {
    expect(ipPrefix("200.155.10.42")).toBe("200.155.x.x");
  });
  it("reduz IPv6 a três grupos", () => {
    expect(ipPrefix("2804:14d:1: abc")).toContain("::");
  });
  it("usa o primeiro IP de x-forwarded-for", () => {
    expect(ipPrefix("200.155.10.42, 10.0.0.1")).toBe("200.155.x.x");
  });
  it("ignora valores inválidos", () => {
    expect(ipPrefix("")).toBeNull();
    expect(ipPrefix("abc")).toBeNull();
  });
});

describe("summarizeByPerson", () => {
  it("agrega acessos, falhas, dispositivo mais usado e série diária", () => {
    const events = [
      ev({ created_at: "2026-09-05T12:00:00Z" }),
      ev({ created_at: "2026-09-05T18:00:00Z", device: "Celular" }),
      ev({ created_at: "2026-09-04T12:00:00Z" }),
      ev({ event: "failed", created_at: "2026-09-04T11:00:00Z" }),
    ];
    const [ana] = summarizeByPerson(events, [
      { userId: "u1", name: "Ana", email: "ana@x.com", kind: "team", clientName: null },
    ], TZ);
    expect(ana!.signIns).toBe(3);
    expect(ana!.failed).toBe(1);
    expect(ana!.lastSignInAt).toBe("2026-09-05T18:00:00Z");
    expect(ana!.topDevice).toBe("Computador");
    expect(ana!.daily.map((d) => d.count)).toEqual([1, 2]);
  });

  it("mantém quem nunca acessou com último acesso nulo e no fim da lista", () => {
    const people = [
      { userId: "u1", name: "Ana", email: "ana@x.com", kind: "team" as const, clientName: null },
      { userId: "u2", name: "Bia", email: "bia@x.com", kind: "team" as const, clientName: null },
    ];
    const out = summarizeByPerson([ev({})], people, TZ);
    expect(out).toHaveLength(2);
    expect(out.at(-1)!.name).toBe("Bia");
    expect(out.at(-1)!.lastSignInAt).toBeNull();
  });

  it("separa contato do portal com nome do cliente", () => {
    const out = summarizeByPerson(
      [ev({ user_id: "u9", kind: "portal_client", client_name: "Taveira", person_name: "Léo" })],
      [{ userId: "u9", name: "Léo", email: null, kind: "portal_client", clientName: "Taveira" }],
      TZ,
    );
    expect(out[0]!.kind).toBe("portal_client");
    expect(out[0]!.clientName).toBe("Taveira");
  });
});

describe("computeActivitySummary", () => {
  it("conta pessoas distintas por janela e quem nunca acessou", () => {
    const now = new Date("2026-09-06T15:00:00Z");
    const events = [
      ev({ user_id: "u1", created_at: "2026-09-06T13:00:00Z" }),
      ev({ user_id: "u1", created_at: "2026-09-06T14:00:00Z" }),
      ev({ user_id: "u2", created_at: "2026-09-01T14:00:00Z" }),
      ev({ user_id: "u3", created_at: "2026-08-15T14:00:00Z" }),
      ev({ user_id: "u4", event: "failed", created_at: "2026-09-06T14:30:00Z" }),
    ];
    const s = computeActivitySummary(events, 6, now, TZ);
    expect(s.activeToday).toBe(1);
    expect(s.active7d).toBe(2);
    expect(s.active30d).toBe(3);
    expect(s.totalSignIns).toBe(4);
    expect(s.failed).toBe(1);
    expect(s.neverAccessed).toBe(3);
  });
});

describe("dayKey", () => {
  it("usa o fuso de Brasília para virar o dia", () => {
    expect(dayKey("2026-09-06T02:30:00Z", TZ)).toBe("2026-09-05");
  });
});

describe("toCsv", () => {
  it("gera cabeçalho pt-BR e escapa aspas", () => {
    const csv = toCsv([ev({ person_name: 'Ana "A"' })], () => "06/09/2026 10:00");
    expect(csv.split("\n")[0]).toContain("Data/hora");
    expect(csv).toContain('Ana ""A""');
    expect(csv).toContain("Equipe");
  });
});

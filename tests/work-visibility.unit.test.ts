import { describe, expect, it } from "vitest";
import { isItemDone, matchesDue, matchesVisibility, needsArchived } from "@/lib/work-visibility";

describe("filtros de visibilidade", () => {
  const active = { done: false, status: "doing", archived_at: null };
  const done = { done: true, status: "done", archived_at: "2026-01-01T00:00:00Z" };
  const archived = { done: false, status: "doing", archived_at: "2026-01-01T00:00:00Z" };

  it("ativos escondem concluídos e arquivados", () => {
    expect(matchesVisibility(active, "active")).toBe(true);
    expect(matchesVisibility(done, "active")).toBe(false);
    expect(matchesVisibility(archived, "active")).toBe(false);
  });

  it("concluídos e arquivados são recuperáveis", () => {
    expect(matchesVisibility(done, "done")).toBe(true);
    expect(matchesVisibility(archived, "archived")).toBe(true);
    expect(matchesVisibility(active, "all")).toBe(true);
  });

  it("isItemDone e needsArchived", () => {
    expect(isItemDone(done)).toBe(true);
    expect(needsArchived("active")).toBe(false);
    expect(needsArchived("archived")).toBe(true);
  });
});

describe("filtros de prazo", () => {
  const now = new Date("2026-03-10T15:00:00-03:00");

  it("atrasadas só contam itens em aberto", () => {
    expect(matchesDue("2026-03-01T12:00:00-03:00", false, "overdue", now)).toBe(true);
    expect(matchesDue("2026-03-01T12:00:00-03:00", true, "overdue", now)).toBe(false);
  });

  it("hoje, amanhã e 7 dias", () => {
    expect(matchesDue("2026-03-10T09:00:00-03:00", false, "today", now)).toBe(true);
    expect(matchesDue("2026-03-11T09:00:00-03:00", false, "tomorrow", now)).toBe(true);
    expect(matchesDue("2026-03-15T09:00:00-03:00", false, "week", now)).toBe(true);
    expect(matchesDue("2026-04-01T09:00:00-03:00", false, "week", now)).toBe(false);
  });

  it("sem prazo", () => {
    expect(matchesDue(null, false, "none", now)).toBe(true);
    expect(matchesDue(null, false, "today", now)).toBe(false);
    expect(matchesDue(null, false, "all", now)).toBe(true);
  });
});

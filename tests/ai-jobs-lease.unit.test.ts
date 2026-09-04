import { describe, expect, it } from "vitest";
import {
  canClaimLease,
  isLeaseValid,
  jobTtlMs,
  leaseExpiryIso,
  newLeaseOwner,
  shouldReapJob,
  type LeaseJob,
} from "@/lib/ai-job-lease";
import { pickLockHolder } from "@/lib/monthly-plan-lock.server";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function job(over: Partial<LeaseJob> = {}): LeaseJob {
  return {
    kind: "monthly_plan",
    status: "running",
    updated_at: iso(-30_000),
    heartbeat_at: iso(-30_000),
    lease_owner: "owner-a",
    lease_expires_at: iso(60_000),
    ...over,
  };
}

describe("lease/TTL dos ai_jobs", () => {
  it("job dentro do prazo continua válido e NÃO é encerrado pelo reaper", () => {
    const j = job();
    expect(isLeaseValid(j, NOW)).toBe(true);
    expect(shouldReapJob(j, NOW)).toBe(false);
  });

  it("geração de pauta acima de 5 min com heartbeat segue válida (regressão do reaper prematuro)", () => {
    const j = job({
      lease_expires_at: iso(90_000),
      heartbeat_at: iso(-20_000),
      updated_at: iso(-8 * 60_000),
    });
    expect(shouldReapJob(j, NOW)).toBe(false);
  });

  it("job sem lease usa o TTL do próprio tipo", () => {
    expect(jobTtlMs("monthly_plan")).toBe(12 * 60_000);
    expect(jobTtlMs("customer_strategy")).toBe(15 * 60_000);
    expect(jobTtlMs("qualquer_outro")).toBe(5 * 60_000);

    const semLease = job({ lease_owner: null, lease_expires_at: null, heartbeat_at: null });
    expect(shouldReapJob({ ...semLease, updated_at: iso(-6 * 60_000) }, NOW)).toBe(false);
    expect(shouldReapJob({ ...semLease, updated_at: iso(-13 * 60_000) }, NOW)).toBe(true);
    expect(
      shouldReapJob({ ...semLease, kind: "copilot", updated_at: iso(-6 * 60_000) }, NOW),
    ).toBe(true);
  });

  it("job expirado é encerrado e liberado para novo dono", () => {
    const expirado = job({ lease_expires_at: iso(-1_000) });
    expect(isLeaseValid(expirado, NOW)).toBe(false);
    expect(shouldReapJob(expirado, NOW)).toBe(true);
    expect(canClaimLease(expirado, "owner-b", NOW)).toBe(true);
  });

  it("job terminal nunca é encerrado nem reclamado", () => {
    for (const status of ["succeeded", "failed", "cancelled"]) {
      const j = job({ status, lease_expires_at: iso(-1_000) });
      expect(shouldReapJob(j, NOW)).toBe(false);
      expect(canClaimLease(j, "owner-b", NOW)).toBe(false);
    }
  });

  it("worker concorrente não assume job com lease válida (sem processamento duplicado)", () => {
    const j = job();
    expect(canClaimLease(j, "owner-b", NOW)).toBe(false);
    // O próprio dono pode renovar.
    expect(canClaimLease(j, "owner-a", NOW)).toBe(true);
  });

  it("leaseExpiryIso respeita o mínimo de 10s", () => {
    expect(Date.parse(leaseExpiryIso(1, NOW)) - NOW).toBe(10_000);
    expect(Date.parse(leaseExpiryIso(120, NOW)) - NOW).toBe(120_000);
    expect(newLeaseOwner("x")).toMatch(/^x-[0-9a-f-]{36}$/);
  });
});

describe("trava de geração de pauta", () => {
  const row = (id: string, createdOffset: number, over: Partial<LeaseJob> = {}) => ({
    id,
    created_at: iso(createdOffset),
    ...job(over),
  });

  it("lock ainda válido: a trava mais antiga vence e a segunda execução vira conflito", () => {
    const rows = [row("b", -1_000), row("a", -60_000)];
    expect(pickLockHolder(rows, NOW)?.id).toBe("a");
  });

  it("worker concorrente no mesmo instante: desempate estável por id", () => {
    const rows = [row("b2", -1_000), row("a1", -1_000)];
    expect(pickLockHolder(rows, NOW)?.id).toBe("a1");
  });

  it("reprocessamento após falha: trava órfã (lease expirada) não bloqueia", () => {
    const rows = [row("orfa", -20 * 60_000, { lease_expires_at: iso(-5 * 60_000) })];
    expect(pickLockHolder(rows, NOW)).toBeUndefined();
    // A nova execução assume sozinha.
    const comNova = [...rows, row("nova", 0)];
    expect(pickLockHolder(comNova, NOW)?.id).toBe("nova");
  });

  it("sem travas ativas nenhum dono é apontado", () => {
    expect(pickLockHolder([], NOW)).toBeUndefined();
  });
});

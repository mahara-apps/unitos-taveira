import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Camada de execução/histórico de importação de briefing.
 * Cobre idempotência, concorrência, estados, isolamento brand/client,
 * decisões e apply idempotente — sem tocar no banco real.
 */

const writeCanonicalBriefing = vi.fn(async () => ({
  hub: {},
  completion: 50,
  changedFields: ["positioning"],
  versionId: "version-1",
}));

vi.mock("@/lib/briefing-write.server", () => ({ writeCanonicalBriefing }));
vi.mock("@/lib/supabase-rpc", () => ({ callRpc: vi.fn(async () => "event-1") }));

const {
  startImportRun,
  claimImportRun,
  saveImportProposal,
  decideImportChanges,
  applyImportRun,
  failImportRun,
  retryImportRun,
  listImportRuns,
  buildInputFingerprint,
  classifyChange,
  computeCounts,
} = await import("@/lib/briefing-import.server");

/* ---------------- fake supabase (in-memory) ---------------- */

type Row = Record<string, any>;

function makeDb() {
  const tables: Record<string, Row[]> = {
    briefing_import_runs: [],
    briefing_import_steps: [],
    briefing_import_changes: [],
  };
  let seq = 0;
  const uniqueActive = new Set<string>();
  const ACTIVE = ["queued", "running", "proposed", "applying"];

  function builder(name: string) {
    const rows = tables[name]!;
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "update" | "insert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let orderKey: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;
    let insertError: unknown = null;

    const api: any = {
      select() {
        if (mode === "select") mode = "select";
        return api;
      },
      insert(v: Row | Row[]) {
        mode = "insert";
        payload = v;
        const list = Array.isArray(v) ? v : [v];
        for (const r of list) {
          if (name === "briefing_import_runs" && r.idempotency_key) {
            if (uniqueActive.has(r.idempotency_key)) {
              insertError = { code: "23505", message: "unique_violation" };
              return api;
            }
          }
        }
        return api;
      },
      update(v: Row) {
        mode = "update";
        payload = v;
        return api;
      },
      delete() {
        mode = "delete";
        return api;
      },
      eq(k: string, v: unknown) {
        filters.push((r) => r[k] === v);
        return api;
      },
      in(k: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[k]));
        return api;
      },
      order(k: string, opts?: { ascending?: boolean }) {
        orderKey = k;
        orderAsc = opts?.ascending !== false;
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      run() {
        if (mode === "insert") {
          if (insertError) return { data: null, error: insertError };
          const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
          const created = list.map((r) => {
            seq += 1;
            const row = { id: `${name}-${seq}`, created_at: new Date(2026, 0, seq).toISOString(), ...r };
            rows.push(row);
            if (name === "briefing_import_runs" && row.idempotency_key) {
              uniqueActive.add(row.idempotency_key);
            }
            return row;
          });
          return { data: created, error: null };
        }
        let matched = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === "update") {
          for (const r of matched) {
            for (const [k, v] of Object.entries(payload as Row)) {
              if (v === undefined) continue;
              r[k] = v;
            }
            if (name === "briefing_import_runs" && r.idempotency_key) {
              if (ACTIVE.includes(r.status)) uniqueActive.add(r.idempotency_key);
              else uniqueActive.delete(r.idempotency_key);
            }
          }
          return { data: matched, error: null };
        }
        if (mode === "delete") {
          for (const r of matched) rows.splice(rows.indexOf(r), 1);
          return { data: matched, error: null };
        }
        if (orderKey) {
          const key = orderKey;
          matched = [...matched].sort((a, b) =>
            orderAsc ? String(a[key]).localeCompare(String(b[key])) : String(b[key]).localeCompare(String(a[key])),
          );
        }
        if (limitN != null) matched = matched.slice(0, limitN);
        return { data: matched, error: null };
      },
      maybeSingle() {
        const res = api.run();
        const list = (res.data as Row[] | null) ?? [];
        return Promise.resolve({ data: list[0] ?? null, error: res.error });
      },
      then(res: any, rej: any) {
        return Promise.resolve(api.run()).then(res, rej);
      },
    };
    return api;
  }

  return {
    tables,
    client: { from: (name: string) => builder(name) } as any,
  };
}

const SCOPE = {
  brandId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
};

const OTHER_CLIENT = "44444444-4444-4444-4444-444444444444";

async function seedProposedRun(db: ReturnType<typeof makeDb>) {
  const fingerprint = await buildInputFingerprint({
    sourceKind: "document",
    documentPath: "brand/doc.pdf",
    documentSize: 1024,
    documentMime: "application/pdf",
  });
  const { run } = await startImportRun(db.client, {
    ...SCOPE,
    sourceKind: "document",
    documentId: "55555555-5555-5555-5555-555555555555",
    inputFingerprint: fingerprint,
  });
  await claimImportRun(db.client, run.id);
  await saveImportProposal(db.client, run, {
    changes: [
      { field: "positioning", currentValue: null, proposedValue: "Marca premium" },
      { field: "mission", currentValue: "igual", proposedValue: "igual" },
    ],
    summary: "resumo",
    confidence: 0.8,
  });
  return { run, fingerprint };
}

/* ---------------- tests ---------------- */

describe("classificação e contagens", () => {
  it("classifica create/update/keep/discard", () => {
    expect(classifyChange(null, "novo")).toBe("create");
    expect(classifyChange("antigo", "novo")).toBe("update");
    expect(classifyChange("igual", "igual")).toBe("keep");
    expect(classifyChange("antigo", "")).toBe("discard");
  });

  it("conta cada ação", () => {
    expect(
      computeCounts([
        { action: "create" },
        { action: "update" },
        { action: "keep" },
        { action: "discard" },
      ]),
    ).toEqual({ created: 1, updated: 1, kept: 1, discarded: 1 });
  });
});

describe("idempotência da run", () => {
  it("fingerprint de documento é determinístico e sensível ao arquivo", async () => {
    const a = await buildInputFingerprint({
      sourceKind: "document",
      documentPath: "p",
      documentSize: 10,
      documentMime: "application/pdf",
    });
    const b = await buildInputFingerprint({
      sourceKind: "document",
      documentPath: "p",
      documentSize: 10,
      documentMime: "application/pdf",
    });
    const c = await buildInputFingerprint({
      sourceKind: "document",
      documentPath: "p",
      documentSize: 11,
      documentMime: "application/pdf",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("reaproveita a run viva do mesmo conteúdo", async () => {
    const db = makeDb();
    const fp = await buildInputFingerprint({ sourceKind: "paste", rawText: "texto  do   briefing" });
    const first = await startImportRun(db.client, { ...SCOPE, sourceKind: "paste", inputFingerprint: fp });
    const second = await startImportRun(db.client, { ...SCOPE, sourceKind: "paste", inputFingerprint: fp });
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(db.tables.briefing_import_runs).toHaveLength(1);
  });

  it("force cria nova execução", async () => {
    const db = makeDb();
    const fp = await buildInputFingerprint({ sourceKind: "paste", rawText: "texto" });
    await startImportRun(db.client, { ...SCOPE, sourceKind: "paste", inputFingerprint: fp });
    const forced = await startImportRun(db.client, {
      ...SCOPE,
      sourceKind: "paste",
      inputFingerprint: fp,
      force: true,
    });
    expect(forced.reused).toBe(false);
    expect(db.tables.briefing_import_runs).toHaveLength(2);
  });
});

describe("concorrência", () => {
  it("apenas o primeiro claim assume a run", async () => {
    const db = makeDb();
    const fp = await buildInputFingerprint({ sourceKind: "paste", rawText: "x" });
    const { run } = await startImportRun(db.client, { ...SCOPE, sourceKind: "paste", inputFingerprint: fp });
    expect(await claimImportRun(db.client, run.id)).toBe(true);
    expect(await claimImportRun(db.client, run.id)).toBe(false);
  });

  it("apply concorrente não aplica duas vezes", async () => {
    const db = makeDb();
    writeCanonicalBriefing.mockClear();
    const { run } = await seedProposedRun(db);
    await decideImportChanges(db.client, {
      brandId: SCOPE.brandId,
      clientId: SCOPE.clientId,
      runId: run.id,
      userId: SCOPE.userId,
      decisions: [{ field: "positioning", decision: "accepted" }],
    });

    const results = await Promise.allSettled([
      applyImportRun(db.client, { ...SCOPE, runId: run.id }),
      applyImportRun(db.client, { ...SCOPE, runId: run.id }),
    ]);
    const applied = results.filter((r) => r.status === "fulfilled");
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(writeCanonicalBriefing).toHaveBeenCalledTimes(1);
  });
});

describe("estados e apply", () => {
  it("apply aceita campos, gera versão e é idempotente", async () => {
    const db = makeDb();
    writeCanonicalBriefing.mockClear();
    const { run } = await seedProposedRun(db);

    const first = await applyImportRun(db.client, { ...SCOPE, runId: run.id, acceptFields: ["positioning"] });
    expect(first.versionId).toBe("version-1");
    expect(first.appliedFields).toEqual(["positioning"]);
    expect(first.alreadyApplied).toBe(false);

    const second = await applyImportRun(db.client, { ...SCOPE, runId: run.id, acceptFields: ["positioning"] });
    expect(second.alreadyApplied).toBe(true);
    expect(second.versionId).toBe("version-1");
    expect(writeCanonicalBriefing).toHaveBeenCalledTimes(1);
  });

  it("apply sem campos aceitos falha e volta a run para proposed", async () => {
    const db = makeDb();
    const { run } = await seedProposedRun(db);
    await expect(applyImportRun(db.client, { ...SCOPE, runId: run.id })).rejects.toThrow(
      "no_accepted_fields",
    );
    const stored = db.tables.briefing_import_runs.find((r) => r.id === run.id);
    expect(stored?.status).toBe("proposed");
  });

  it("retry só é permitido a partir de failed", async () => {
    const db = makeDb();
    const { run } = await seedProposedRun(db);
    await expect(retryImportRun(db.client, { ...SCOPE, runId: run.id })).rejects.toThrow(
      "import_run_not_retryable",
    );
    await failImportRun(db.client, run, { message: "boom", kind: "analysis" });
    const retried = await retryImportRun(db.client, { ...SCOPE, runId: run.id });
    expect(retried.status).toBe("queued");
    expect(retried.attempt).toBe(1);
  });
});

describe("isolamento brand/client", () => {
  let db: ReturnType<typeof makeDb>;
  let runId: string;

  beforeEach(async () => {
    db = makeDb();
    const seeded = await seedProposedRun(db);
    runId = seeded.run.id;
  });

  it("run não é visível para outro cliente", async () => {
    const runs = await listImportRuns(db.client, { brandId: SCOPE.brandId, clientId: OTHER_CLIENT });
    expect(runs).toHaveLength(0);
  });

  it("apply com cliente errado não encontra a run", async () => {
    await expect(
      applyImportRun(db.client, { ...SCOPE, clientId: OTHER_CLIENT, runId }),
    ).rejects.toThrow("import_run_not_found");
  });

  it("decisão com cliente errado não altera a proposta", async () => {
    await decideImportChanges(db.client, {
      brandId: SCOPE.brandId,
      clientId: OTHER_CLIENT,
      runId,
      userId: SCOPE.userId,
      decisions: [{ field: "positioning", decision: "accepted" }],
    }).catch(() => undefined);
    const change = db.tables.briefing_import_changes.find((c) => c.field === "positioning");
    expect(change?.decision).toBe("pending");
  });
});

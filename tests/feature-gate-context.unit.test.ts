/**
 * Correção do Feature Gate — sincronização com o contexto canônico de workspace.
 *
 * Cobre o bug em que `localStorage["nx.brand"] = null` (após `resetIdentityState`)
 * fazia o gate concluir "módulo não disponível no seu plano". Nada aqui altera
 * RBAC/RLS: `requireFeatureAccess` (servidor) é mockado apenas para exercitar a
 * camada de contexto/cache no cliente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireFeatureAccess = vi.fn();

vi.mock("@/lib/feature-flags.functions", () => ({
  requireFeatureAccess: (args: unknown) => requireFeatureAccess(args),
}));
vi.mock("@/lib/portal-access.functions", () => ({ getMyPortalAccessFn: vi.fn() }));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

// Entitlements reais do ambiente: só `chat` e `midia_paga` desabilitados.
const DISABLED = new Set(["chat", "midia_paga"]);

async function load() {
  const ws = await import("@/lib/active-workspace");
  const cache = await import("@/lib/access-cache");
  const gate = await import("@/lib/feature-flags.gate");
  return { ws, cache, gate };
}

/** Simula o `beforeLoad` de uma rota: captura o redirect lançado pelo gate. */
async function navigate(
  gate: Awaited<ReturnType<typeof load>>["gate"],
  featureKey: string,
): Promise<{ blocked: false } | { blocked: true; reason?: string }> {
  try {
    await gate.ensureFeatureEnabled(featureKey);
    return { blocked: false };
  } catch (e) {
    const search = (e as { options?: { search?: { reason?: string } } }).options?.search;
    return { blocked: true, reason: search?.reason };
  }
}

beforeEach(async () => {
  vi.resetModules();
  requireFeatureAccess.mockReset();
  requireFeatureAccess.mockImplementation(
    async ({ data }: { data: { brandId: string | null; featureKey: string } }) => {
      if (!data.brandId) return { enabled: false, reason: "no_brand" };
      return DISABLED.has(data.featureKey)
        ? { enabled: false, reason: "denied" }
        : { enabled: true, reason: "granted" };
    },
  );
});

describe("feature gate x contexto de workspace", () => {
  it("Teste 1 — usa o workspace do contexto mesmo com localStorage vazio", async () => {
    const { ws, gate } = await load();
    // sem `nx.brand` persistido (equivalente ao pós-`resetIdentityState`)
    ws.publishActiveWorkspace(A, true);

    expect(await navigate(gate, "tasks")).toEqual({ blocked: false });
    expect(requireFeatureAccess).toHaveBeenCalledWith({
      data: { brandId: A, featureKey: "tasks" },
    });
  });

  it("Teste 2 — após SIGNED_IN/reset de identidade, o gate volta a funcionar", async () => {
    const { ws, gate } = await load();
    ws.publishActiveWorkspace(A, true);
    expect(await navigate(gate, "projects")).toEqual({ blocked: false });

    ws.markActiveWorkspaceUnresolved();
    // O contexto é reconstruído logo após o reset.
    setTimeout(() => ws.publishActiveWorkspace(A, true), 5);
    expect(await navigate(gate, "projects")).toEqual({ blocked: false });
  });

  it("Teste 3 — workspace ausente não é classificado como feature desabilitada", async () => {
    const { ws, gate } = await load();
    ws.publishActiveWorkspace(null, true);
    const r = await navigate(gate, "brain");
    expect(r).toEqual({ blocked: true, reason: "no_workspace" });
  });

  it("Teste 4 — gate reavalia quando o workspace é resolvido depois", async () => {
    const { ws, gate } = await load();
    // Contexto ainda indefinido no primeiro render.
    setTimeout(() => ws.publishActiveWorkspace(A, true), 10);
    expect(await navigate(gate, "calendar")).toEqual({ blocked: false });
  });

  it("Teste 5 — negativo derivado de workspace null não é cacheado", async () => {
    const { ws, cache, gate } = await load();
    expect(await cache.getCachedFeatureAccess(null, "calendar")).toEqual({
      enabled: false,
      reason: "no_workspace",
    });
    ws.publishActiveWorkspace(A, true);
    expect(await navigate(gate, "calendar")).toEqual({ blocked: false });
  });

  it("Teste 6 — troca de workspace usa os entitlements do novo workspace", async () => {
    const { ws, gate } = await load();
    requireFeatureAccess.mockImplementation(
      async ({ data }: { data: { brandId: string | null; featureKey: string } }) => ({
        enabled: data.brandId === B,
        reason: data.brandId === B ? "granted" : "denied",
      }),
    );
    ws.publishActiveWorkspace(A, true);
    expect((await navigate(gate, "analytics")).blocked).toBe(true);

    ws.publishActiveWorkspace(B, true);
    expect(await navigate(gate, "analytics")).toEqual({ blocked: false });
  });

  it("Teste 7 — logout/troca de identidade não herda entitlement anterior", async () => {
    const { ws, cache, gate } = await load();
    ws.publishActiveWorkspace(A, true);
    expect(await navigate(gate, "agents")).toEqual({ blocked: false });

    cache.clearAccessCaches();
    ws.markActiveWorkspaceUnresolved();
    requireFeatureAccess.mockResolvedValue({ enabled: false, reason: "denied" });
    ws.publishActiveWorkspace(B, true);
    expect(await navigate(gate, "agents")).toEqual({ blocked: true, reason: "feature_disabled" });
  });

  it("Teste 8 — ADMIN com workspace e sem cliente acessa módulos de workspace", async () => {
    const { ws, gate } = await load();
    ws.publishActiveWorkspace(A, true); // clientId permanece null (sem auto-seleção)
    for (const key of ["customers", "projects", "tasks", "calendar", "brain", "blog_post"]) {
      expect(await navigate(gate, key)).toEqual({ blocked: false });
    }
  });

  it("Teste 9 — feature realmente desabilitada retorna feature_disabled", async () => {
    const { ws, gate } = await load();
    ws.publishActiveWorkspace(A, true);
    expect(await navigate(gate, "chat")).toEqual({ blocked: true, reason: "feature_disabled" });
    expect(await navigate(gate, "midia_paga")).toEqual({
      blocked: true,
      reason: "feature_disabled",
    });
  });

  it("erro de consulta não é apresentado como bloqueio de plano", async () => {
    const { ws, cache, gate } = await load();
    ws.publishActiveWorkspace(A, true);
    requireFeatureAccess.mockRejectedValue(new Error("network"));
    expect(await cache.getCachedFeatureAccess(A, "notifications")).toEqual({
      enabled: true,
      reason: "entitlement_error",
    });
    expect(await navigate(gate, "notifications")).toEqual({ blocked: false });
  });
});

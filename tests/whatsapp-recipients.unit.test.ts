// Testes da camada de destinatários + envio de WhatsApp (Evolution).
// Cobrem: contato de cliente, múltiplos contatos, gestor da conta, ADMIN,
// usuário específico, grupo, destinatário de outro cliente/workspace, telefone
// e grupo inválidos, instância de outro workspace, usuário sem permissão,
// envio bem-sucedido e erro da Evolution.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { isGroupJid, normalizePhone, parseDestination } from "@/lib/whatsapp/destination";
import { resolveRecipients } from "@/lib/whatsapp/recipients.server";

const BRAND_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "33333333-3333-4333-8333-333333333333";
const CLIENT_B = "44444444-4444-4444-8444-444444444444";
const USER_ADMIN = "55555555-5555-4555-8555-555555555555";
const USER_MANAGER = "66666666-6666-4666-8666-666666666666";
const USER_NO_PHONE = "77777777-7777-4777-8777-777777777777";
const ACTOR = "88888888-8888-4888-8888-888888888888";

type Recipient = Record<string, unknown>;

const recipients: Recipient[] = [
  {
    id: "r-contact",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "client_contact",
    name: "João",
    role_label: "Proprietário",
    destination: "5531988887777",
    is_active: true,
  },
  {
    id: "r-contact-2",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "client_contact",
    name: "Maria",
    role_label: "Financeiro",
    destination: "5531977776666",
    is_active: true,
  },
  {
    id: "r-group",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "whatsapp_group",
    name: "Equipe ABC",
    role_label: null,
    destination: "120363012345678901@g.us",
    is_active: true,
  },
  {
    id: "r-group-bad",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "whatsapp_group",
    name: "Grupo inválido",
    role_label: null,
    destination: "5531988887777",
    is_active: true,
  },
  {
    id: "r-phone-bad",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "client_contact",
    name: "Telefone ruim",
    role_label: null,
    destination: "123",
    is_active: true,
  },
  {
    id: "r-manager",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "account_manager",
    name: "Gestor da conta",
    role_label: null,
    destination: null,
    is_active: true,
  },
  {
    id: "r-admin",
    brand_id: BRAND_A,
    client_id: null,
    user_id: null,
    type: "workspace_admin",
    name: "ADMIN",
    role_label: null,
    destination: null,
    is_active: true,
  },
  {
    id: "r-user",
    brand_id: BRAND_A,
    client_id: null,
    user_id: USER_MANAGER,
    type: "workspace_user",
    name: "Carlos",
    role_label: null,
    destination: null,
    is_active: true,
  },
  {
    id: "r-user-no-phone",
    brand_id: BRAND_A,
    client_id: null,
    user_id: USER_NO_PHONE,
    type: "workspace_user",
    name: "Sem telefone",
    role_label: null,
    destination: null,
    is_active: true,
  },
  {
    id: "r-other-client",
    brand_id: BRAND_A,
    client_id: CLIENT_B,
    user_id: null,
    type: "client_contact",
    name: "Fora do escopo",
    role_label: null,
    destination: "5531911112222",
    is_active: true,
  },
  {
    id: "r-other-brand",
    brand_id: BRAND_B,
    client_id: CLIENT_B,
    user_id: null,
    type: "client_contact",
    name: "Outro workspace",
    role_label: null,
    destination: "5531933334444",
    is_active: true,
  },
];

const profiles: Record<string, { full_name: string; whatsapp: string | null; phone: string | null }> =
  {
    [USER_ADMIN]: { full_name: "Bruno", whatsapp: "+55 31 98888-0001", phone: null },
    [USER_MANAGER]: { full_name: "Carlos", whatsapp: null, phone: "31 98888-0002" },
    [USER_NO_PHONE]: { full_name: "Sem telefone", whatsapp: null, phone: null },
  };

const members = [
  { brand_id: BRAND_A, user_id: USER_ADMIN, role: "owner", is_active: true },
  { brand_id: BRAND_A, user_id: USER_MANAGER, role: "manager", is_active: true },
  { brand_id: BRAND_A, user_id: USER_NO_PHONE, role: "user", is_active: true },
];

/** Supabase falso: aplica o "RLS" do escopo do ator na leitura. */
function fakeSupabase(options: { brandRole?: string | null; scopedClients?: string[] } = {}) {
  const brandRole = options.brandRole === undefined ? "manager" : options.brandRole;
  const scoped = options.scopedClients ?? [CLIENT_A];

  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    let inFilter: { column: string; values: unknown[] } | null = null;

    const rowsFor = (): Record<string, unknown>[] => {
      if (table === "whatsapp_recipients") {
        return recipients.filter((r) => {
          if (inFilter && !inFilter.values.includes(r[inFilter.column])) return false;
          for (const [k, v] of Object.entries(filters)) if (r[k] !== v) return false;
          // RLS: workspace + escopo do cliente.
          const clientId = r["client_id"] as string | null;
          if (clientId && !scoped.includes(clientId)) return false;
          return true;
        });
      }
      if (table === "user_profiles") {
        return Object.entries(profiles)
          .filter(([id]) => !filters["id"] || filters["id"] === id)
          .filter(([id]) => !inFilter || inFilter.values.includes(id))
          .map(([id, p]) => ({ id, ...p }));
      }
      if (table === "brand_members") {
        return members.filter((m) => {
          for (const [k, v] of Object.entries(filters)) {
            if ((m as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        }) as unknown as Record<string, unknown>[];
      }
      if (table === "clients") {
        const id = filters["id"];
        if (id === CLIENT_A) {
          return [{ id: CLIENT_A, brand_id: BRAND_A, owner_user_id: USER_MANAGER }];
        }
        if (id === CLIENT_B) {
          return [{ id: CLIENT_B, brand_id: BRAND_A, owner_user_id: USER_MANAGER }];
        }
        return [];
      }
      return [];
    };

    const api: Record<string, unknown> = {
      select: () => api,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return api;
      },
      in: (column: string, values: unknown[]) => {
        inFilter = { column, values };
        return api;
      },
      order: () => api,
      limit: () => Promise.resolve({ data: rowsFor(), error: null }),
      maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rowsFor(), error: null }),
    };
    return api;
  };

  return {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "app_access_role") return Promise.resolve({ data: brandRole, error: null });
      if (fn === "can_access_client") {
        return Promise.resolve({ data: scoped.includes(args["_client_id"] as string), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as never;
}

describe("destino de WhatsApp", () => {
  it("normaliza telefone brasileiro e rejeita telefone inválido", () => {
    expect(normalizePhone("+55 (31) 98888-7777")).toBe("5531988887777");
    expect(normalizePhone("31 98888-7777")).toBe("5531988887777");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("reconhece grupo e nunca o trata como telefone", () => {
    expect(isGroupJid("120363012345678901@g.us")).toBe(true);
    expect(isGroupJid("5511999999999")).toBe(false);
    expect(normalizePhone("120363012345678901@g.us")).toBeNull();
    expect(parseDestination("group", "5511999999999")).toBeNull();
    expect(parseDestination("group", "120363012345678901@g.us")).toEqual({
      kind: "group",
      value: "120363012345678901@g.us",
    });
  });
});

describe("resolução de destinatários", () => {
  it("resolve contato de cliente", async () => {
    const { resolved, unresolved } = await resolveRecipients(
      fakeSupabase(),
      ACTOR,
      BRAND_A,
      ["r-contact"],
    );
    expect(unresolved).toHaveLength(0);
    expect(resolved[0]).toMatchObject({
      type: "client_contact",
      destination: { kind: "phone", value: "5531988887777" },
    });
  });

  it("resolve múltiplos destinatários (contatos + grupo + gestor)", async () => {
    const { resolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, [
      "r-contact",
      "r-contact-2",
      "r-group",
      "r-manager",
    ]);
    expect(resolved).toHaveLength(4);
    expect(resolved.map((r) => r.destination.kind)).toEqual(["phone", "phone", "group", "phone"]);
  });

  it("resolve gestor da conta a partir do responsável do cliente", async () => {
    const { resolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, ["r-manager"]);
    expect(resolved[0]).toMatchObject({
      type: "account_manager",
      label: "Carlos",
      destination: { kind: "phone", value: "5531988880002" },
    });
  });

  it("resolve ADMIN do workspace", async () => {
    const { resolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, ["r-admin"]);
    expect(resolved[0]).toMatchObject({
      type: "workspace_admin",
      destination: { kind: "phone", value: "5531988880001" },
    });
  });

  it("resolve usuário específico sem duplicar cadastro", async () => {
    const { resolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, ["r-user"]);
    expect(resolved[0]).toMatchObject({
      type: "workspace_user",
      label: "Carlos",
      destination: { kind: "phone", value: "5531988880002" },
    });
  });

  it("resolve grupo de WhatsApp com JID próprio", async () => {
    const { resolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, ["r-group"]);
    expect(resolved[0]!.destination).toEqual({
      kind: "group",
      value: "120363012345678901@g.us",
    });
  });

  it("rejeita destinatário de outro cliente (fora do escopo)", async () => {
    const { resolved, unresolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, [
      "r-other-client",
    ]);
    expect(resolved).toHaveLength(0);
    expect(unresolved[0]!.reason).toBe("not_found");
  });

  it("rejeita destinatário de outro workspace", async () => {
    const { resolved, unresolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, [
      "r-other-brand",
    ]);
    expect(resolved).toHaveLength(0);
    expect(unresolved[0]!.reason).toBe("not_found");
  });

  it("rejeita telefone e grupo inválidos", async () => {
    const { unresolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, [
      "r-phone-bad",
      "r-group-bad",
    ]);
    expect(unresolved.map((u) => u.reason)).toEqual([
      "invalid_destination",
      "invalid_destination",
    ]);
  });

  it("sinaliza usuário sem telefone cadastrado", async () => {
    const { unresolved } = await resolveRecipients(fakeSupabase(), ACTOR, BRAND_A, [
      "r-user-no-phone",
    ]);
    expect(unresolved[0]!.reason).toBe("missing_phone");
  });

  it("bloqueia usuário sem permissão no workspace", async () => {
    await expect(
      resolveRecipients(fakeSupabase({ brandRole: null }), ACTOR, BRAND_A, ["r-contact"]),
    ).rejects.toThrow(/workspace/i);
  });
});

describe("serviço único de envio", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadSend(evolutionImpl: () => Promise<{ data: unknown }>) {
    vi.doMock("@/lib/evolution/client.server", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/evolution/client.server")
      >("@/lib/evolution/client.server");
      return { ...actual, evolutionRequest: vi.fn(evolutionImpl) };
    });
    vi.doMock("@/lib/evolution/scope.server", () => ({
      loadInstance: async (_s: unknown, brandId: string, instanceId: string) => {
        if (instanceId !== "inst-a" || brandId !== BRAND_A) {
          throw new Error("Instância não encontrada neste workspace.");
        }
        return {
          id: "inst-a",
          brand_id: BRAND_A,
          client_id: null,
          instance_name: "u-brand-a-wa",
          status: "connected",
        };
      },
      resolveInstanceConfig: async () => ({
        baseUrl: "https://evo.example.com",
        apiKey: "k",
        source: { baseUrl: "installation", apiKey: "installation" },
      }),
    }));
    vi.doMock("@/lib/messaging-log.server", () => ({ logMessage: async () => "log-id" }));
    return import("@/lib/whatsapp/send.server");
  }

  it("envia com sucesso para múltiplos destinatários", async () => {
    const { sendWhatsappToRecipients } = await loadSend(async () => ({
      data: { key: { id: "MSG-1" } },
    }));
    const summary = await sendWhatsappToRecipients(fakeSupabase(), ACTOR, {
      brandId: BRAND_A,
      instanceId: "inst-a",
      recipientIds: ["r-contact", "r-group", "r-admin"],
      message: "Olá",
    });
    expect(summary.sent).toBe(3);
    expect(summary.failed).toBe(0);
    // O telefone nunca aparece inteiro no resultado.
    expect(summary.results.find((r) => r.type === "client_contact")!.destination).not.toContain(
      "988887777",
    );
  });

  it("registra falha quando a Evolution retorna erro, sem vazar credencial", async () => {
    const { sendWhatsappToRecipients } = await loadSend(async () => {
      const { EvolutionApiError } = await import("@/lib/evolution/client.server");
      throw new EvolutionApiError("provider_error", "Evolution indisponível.", { status: 502 });
    });
    const summary = await sendWhatsappToRecipients(fakeSupabase(), ACTOR, {
      brandId: BRAND_A,
      instanceId: "inst-a",
      recipientIds: ["r-contact"],
      message: "Olá",
    });
    expect(summary.failed).toBe(1);
    expect(summary.results[0]!.error).toBe("Evolution indisponível.");
    expect(JSON.stringify(summary)).not.toContain("evo.example.com");
  });

  it("recusa instância de outro workspace", async () => {
    const { sendWhatsappToRecipients } = await loadSend(async () => ({ data: {} }));
    await expect(
      sendWhatsappToRecipients(fakeSupabase(), ACTOR, {
        brandId: BRAND_B,
        instanceId: "inst-a",
        recipientIds: ["r-contact"],
        message: "Olá",
      }),
    ).rejects.toThrow(/workspace/i);
  });
});

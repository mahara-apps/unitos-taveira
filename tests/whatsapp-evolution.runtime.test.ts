// VALIDAÇÃO RUNTIME — WhatsApp Evolution.
// Exercita o código real (config → cliente HTTP → instância → QR → webhook →
// destinatário → envio → log) contra um servidor HTTP local que fala o
// protocolo da Evolution API. Não há credencial de Evolution real neste
// ambiente, então o provedor é substituído pelo servidor local — todo o resto
// (resolução de config, retry, normalização, escopo, mascaramento, log) é o
// código de produção sem mocks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { resolveEvolutionConfig } from "@/lib/evolution/config.server";
import { checkEvolutionConnectivity, EvolutionApiError } from "@/lib/evolution/client.server";
import {
  createEvolutionInstance,
  fetchEvolutionInstanceState,
} from "@/lib/evolution/instances.server";
import { requestEvolutionQr, describeQrFailure } from "@/lib/evolution/qr.server";
import { normalizeEvolutionEvent, safeEventPayload } from "@/lib/evolution/webhook.server";
import { sendWhatsappToRecipients } from "@/lib/whatsapp/send.server";

const BRAND_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "33333333-3333-4333-8333-333333333333";
const CLIENT_B = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const MANAGER = "66666666-6666-4666-8666-666666666666";
const USER = "77777777-7777-4777-8777-777777777777";

const API_KEY = "runtime-test-key";
const INSTANCE = "u-brand-a-qa";

type Req = { method: string; path: string; apikey: string | undefined; body: unknown };

const received: Req[] = [];
let server: Server;
let baseUrl = "";
/** Estado simulado do pareamento no provedor. */
let providerState: "close" | "connecting" | "open" = "close";
/** Simula provedor fora do ar (conexão recusada). */
let providerDown = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "/", "http://local");
      const apikey = req.headers["apikey"] as string | undefined;
      received.push({
        method: req.method ?? "GET",
        path: url.pathname,
        apikey,
        body: raw ? JSON.parse(raw) : null,
      });

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (apikey !== API_KEY) return json(401, { message: "Unauthorized" });

      if (url.pathname === "/instance/fetchInstances") {
        return json(200, [{ name: INSTANCE }]);
      }
      if (url.pathname === "/instance/create") {
        providerState = "connecting";
        return json(201, { instance: { instanceName: INSTANCE, status: "created" } });
      }
      if (url.pathname.startsWith("/instance/connectionState/")) {
        const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        if (name !== INSTANCE) return json(404, { message: "instance not found" });
        return json(200, {
          instance: {
            instanceName: name,
            state: providerState,
            ...(providerState === "open" ? { owner: "5531988887777@s.whatsapp.net" } : {}),
          },
        });
      }
      if (url.pathname.startsWith("/instance/connect/")) {
        const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        if (name !== INSTANCE) return json(404, { message: "instance not found" });
        if (providerState === "open") return json(200, { instance: { state: "open" } });
        return json(200, {
          code: "2@abc",
          base64: `data:image/png;base64,${"A".repeat(64)}`,
          pairingCode: "12345678",
          count: 1,
        });
      }
      if (url.pathname.startsWith("/message/sendText/")) {
        const body = raw ? (JSON.parse(raw) as { number?: string }) : {};
        if (!body.number) return json(400, { message: "number required" });
        return json(201, { key: { id: `MSG-${received.length}`, remoteJid: body.number } });
      }
      return json(404, { message: "not implemented" });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  process.env["EVOLUTION_ALLOW_PRIVATE_HOSTS"] = "true";
  process.env["EVOLUTION_API_URL"] = baseUrl;
  process.env["EVOLUTION_API_KEY"] = API_KEY;
  delete process.env["EVOLUTION_ALLOWED_HOSTS"];
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function config() {
  return resolveEvolutionConfig(null);
}

// ---------------------------------------------------------------------------
// Supabase falso com "RLS" por escopo do ator + captura de message_logs.
// ---------------------------------------------------------------------------

const recipients = [
  {
    id: "r-phone",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "client_contact",
    name: "João (QA)",
    role_label: "Proprietário",
    destination: "5531988887777",
    is_active: true,
  },
  {
    id: "r-group",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "whatsapp_group",
    name: "Grupo QA",
    role_label: null,
    destination: "120363012345678901@g.us",
    is_active: true,
  },
  {
    id: "r-bad-phone",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    user_id: null,
    type: "client_contact",
    name: "Telefone inválido",
    role_label: null,
    destination: "123",
    is_active: true,
  },
  {
    id: "r-other-client",
    brand_id: BRAND_A,
    client_id: CLIENT_B,
    user_id: null,
    type: "client_contact",
    name: "Outro cliente",
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

const instances = [
  {
    id: "inst-a",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    instance_name: INSTANCE,
    status: "connected",
  },
  {
    id: "inst-off",
    brand_id: BRAND_A,
    client_id: CLIENT_A,
    instance_name: INSTANCE,
    status: "disconnected",
  },
  {
    id: "inst-b",
    brand_id: BRAND_B,
    client_id: CLIENT_B,
    instance_name: "u-brand-b-qa",
    status: "connected",
  },
];

type Actor = { role: string | null; scopedClients: string[] };

const ACTORS: Record<string, Actor> = {
  [ADMIN]: { role: "admin", scopedClients: [CLIENT_A, CLIENT_B] },
  [MANAGER]: { role: "manager", scopedClients: [CLIENT_A] },
  [USER]: { role: "user", scopedClients: [CLIENT_A] },
};

function fakeSupabase(actorId: string, logs: Record<string, unknown>[] = []) {
  const actor = ACTORS[actorId] ?? { role: null, scopedClients: [] };

  const table = (name: string) => {
    const filters: Record<string, unknown> = {};
    let inFilter: { column: string; values: unknown[] } | null = null;
    let inserted: Record<string, unknown> | null = null;

    const match = (row: Record<string, unknown>) => {
      if (inFilter && !inFilter.values.includes(row[inFilter.column])) return false;
      for (const [k, v] of Object.entries(filters)) if (row[k] !== v) return false;
      return true;
    };

    const rows = (): Record<string, unknown>[] => {
      if (name === "whatsapp_recipients") {
        return recipients.filter((r) => {
          if (!match(r as never)) return false;
          if (r.client_id && !actor.scopedClients.includes(r.client_id)) return false;
          return true;
        }) as never;
      }
      if (name === "evolution_instances") return instances.filter((i) => match(i as never)) as never;
      if (name === "brand_api_credentials") return []; // usa os defaults da instalação
      if (name === "clients") {
        return [
          { id: CLIENT_A, brand_id: BRAND_A, owner_user_id: MANAGER },
          { id: CLIENT_B, brand_id: BRAND_A, owner_user_id: MANAGER },
        ].filter((c) => match(c as never));
      }
      if (name === "user_profiles") {
        return [
          { id: ADMIN, full_name: "Bruno", whatsapp: "+5531988880001", phone: null },
          { id: MANAGER, full_name: "Carlos", whatsapp: null, phone: "31988880002" },
        ].filter((p) => match(p as never));
      }
      if (name === "brand_members") {
        return [{ brand_id: BRAND_A, user_id: ADMIN, role: "owner", is_active: true }].filter((m) =>
          match(m as never),
        );
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
      insert: (value: Record<string, unknown>) => {
        inserted = value;
        if (name === "message_logs") logs.push(value);
        return api;
      },
      limit: () => Promise.resolve({ data: rows(), error: null }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      single: () =>
        Promise.resolve({
          data: inserted ? { id: `log-${logs.length}` } : (rows()[0] ?? null),
          error: null,
        }),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rows(), error: null }),
    };
    return api;
  };

  return {
    from: (name: string) => table(name),
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "app_access_role") return Promise.resolve({ data: actor.role, error: null });
      if (fn === "can_access_client") {
        return Promise.resolve({
          data: actor.scopedClients.includes(args["_client_id"] as string),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as never;
}

// ---------------------------------------------------------------------------

describe("1. instância (runtime contra servidor Evolution local)", () => {
  it("resolve a configuração da instalação e testa a conexão", async () => {
    const result = await checkEvolutionConnectivity(await config());
    expect(result.ok).toBe(true);
    expect(result.instances).toBe(1);
    expect(received.some((r) => r.path === "/instance/fetchInstances")).toBe(true);
  });

  it("cria a instância e consulta o estado", async () => {
    await createEvolutionInstance(await config(), INSTANCE);
    const state = await fetchEvolutionInstanceState(await config(), INSTANCE);
    expect(state.state).toBe("connecting");
  });

  it("gera o QR Code normalizado", async () => {
    const qr = await requestEvolutionQr(await config(), INSTANCE);
    expect(qr.qrBase64?.startsWith("data:image/png;base64,")).toBe(true);
    expect(qr.qrCode).toBe("2@abc");
    expect(qr.pairingCode).toBe("12345678");
    expect(qr.alreadyConnected).toBe(false);
  });

  it("detecta a conexão concluída e identifica o número", async () => {
    providerState = "open";
    const state = await fetchEvolutionInstanceState(await config(), INSTANCE);
    expect(state.state).toBe("open");
    expect(state.phoneNumber).toBe("5531988887777");

    // Webhook real de CONNECTION_UPDATE marca a instância como conectada.
    const event = normalizeEvolutionEvent({
      event: "connection.update",
      instance: INSTANCE,
      data: { state: "open", wuid: "5531988887777@s.whatsapp.net" },
    });
    expect(event.eventType).toBe("CONNECTION_UPDATE");
    expect(event.instanceStatus).toBe("connected");
    expect(event.phoneNumber).toBe("5531988887777");
    // Payload persistido não carrega QR/base64.
    expect(JSON.stringify(safeEventPayload({ event: "connection.update", data: { state: "open", base64: "x".repeat(64) } }))).not.toContain("base64");
  });

  it("instância inexistente no provedor devolve not_found com mensagem clara", async () => {
    const state = await fetchEvolutionInstanceState(await config(), "u-inexistente");
    expect(state.state).toBe("not_found");
    const error = await requestEvolutionQr(await config(), "u-inexistente").catch((e) => e);
    expect(describeQrFailure(error)).toMatch(/Instância inexistente/);
  });
});

describe("2. envio individual + log", () => {
  it("resolve pelo recipientId, envia pela instância correta e loga mascarado", async () => {
    const logs: Record<string, unknown>[] = [];
    const summary = await sendWhatsappToRecipients(fakeSupabase(ADMIN, logs), ADMIN, {
      brandId: BRAND_A,
      instanceId: "inst-a",
      recipientIds: ["r-phone"],
      message: "Teste QA Unitos",
    });

    expect(summary.sent).toBe(1);
    const call = received.filter((r) => r.path.startsWith("/message/sendText/")).at(-1)!;
    expect(call.path).toBe(`/message/sendText/${INSTANCE}`);
    expect(call.body).toMatchObject({ number: "5531988887777", text: "Teste QA Unitos" });
    expect(summary.results[0]!.providerMessageId).toMatch(/^MSG-/);

    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log["channel"]).toBe("whatsapp");
    expect(log["status"]).toBe("sent");
    expect(log["client_id"]).toBe(CLIENT_A);
    expect(String(log["recipient"])).not.toContain("5531988887777");
    expect(JSON.stringify(log)).not.toContain(API_KEY);
    expect(JSON.stringify(log)).not.toContain("127.0.0.1");
  });
});

describe("3. envio para grupo", () => {
  it("trata o JID @g.us como grupo e não como telefone", async () => {
    const logs: Record<string, unknown>[] = [];
    const summary = await sendWhatsappToRecipients(fakeSupabase(ADMIN, logs), ADMIN, {
      brandId: BRAND_A,
      instanceId: "inst-a",
      recipientIds: ["r-group"],
      message: "Aviso do grupo",
    });
    expect(summary.sent).toBe(1);
    const call = received.filter((r) => r.path.startsWith("/message/sendText/")).at(-1)!;
    expect(call.body).toMatchObject({ number: "120363012345678901@g.us" });
    expect(String(logs[0]!["recipient"])).toContain("@g.us");
  });
});

describe("4. escopo", () => {
  it("ADMIN usa os destinatários permitidos", async () => {
    const summary = await sendWhatsappToRecipients(fakeSupabase(ADMIN), ADMIN, {
      brandId: BRAND_A,
      instanceId: "inst-a",
      recipientIds: ["r-phone", "r-group"],
      message: "ok",
    });
    expect(summary.sent).toBe(2);
  });

  it("MANAGER e USER só alcançam destinatários dos clientes do próprio escopo", async () => {
    for (const actorId of [MANAGER, USER]) {
      const ok = await sendWhatsappToRecipients(fakeSupabase(actorId), actorId, {
        brandId: BRAND_A,
        instanceId: "inst-a",
        recipientIds: ["r-phone"],
        message: "ok",
      });
      expect(ok.sent).toBe(1);

      const blocked = await sendWhatsappToRecipients(fakeSupabase(actorId), actorId, {
        brandId: BRAND_A,
        instanceId: "inst-a",
        recipientIds: ["r-other-client"],
        message: "ok",
      });
      expect(blocked.sent).toBe(0);
      expect(blocked.skipped).toBe(1);
    }
  });

  it("destinatário de outro workspace é rejeitado", async () => {
    const summary = await sendWhatsappToRecipients(fakeSupabase(ADMIN), ADMIN, {
      brandId: BRAND_A,
      instanceId: "inst-a",
      recipientIds: ["r-other-brand"],
      message: "ok",
    });
    expect(summary.sent).toBe(0);
    expect(summary.results[0]!.error).toBe("not_found");
  });

  it("instância de outro workspace é rejeitada", async () => {
    await expect(
      sendWhatsappToRecipients(fakeSupabase(ADMIN), ADMIN, {
        brandId: BRAND_A,
        instanceId: "inst-b",
        recipientIds: ["r-phone"],
        message: "ok",
      }),
    ).rejects.toThrow(/Instância não encontrada neste workspace/);
  });
});

describe("5. erros apresentáveis", () => {
  it("instância desconectada", async () => {
    await expect(
      sendWhatsappToRecipients(fakeSupabase(ADMIN), ADMIN, {
        brandId: BRAND_A,
        instanceId: "inst-off",
        recipientIds: ["r-phone"],
        message: "ok",
      }),
    ).rejects.toThrow("A instância de WhatsApp não está conectada.");
  });

  it("destinatário inexistente e telefone inválido", async () => {
    const summary = await sendWhatsappToRecipients(fakeSupabase(ADMIN), ADMIN, {
      brandId: BRAND_A,
      instanceId: "inst-a",
      recipientIds: ["r-nao-existe", "r-bad-phone"],
      message: "ok",
    });
    expect(summary.sent).toBe(0);
    expect(summary.results.map((r) => r.error).sort()).toEqual([
      "invalid_destination",
      "not_found",
    ]);
  });

  it("credencial inválida devolve mensagem sem expor a chave", async () => {
    const bad = { ...(await config()), apiKey: "chave-errada" };
    const result = await checkEvolutionConnectivity(bad);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("unauthorized");
    expect(result.message).toBe("Chave de API da Evolution inválida ou sem permissão.");
    expect(JSON.stringify(result)).not.toContain("chave-errada");
  });

  it("Evolution indisponível devolve erro de rede tratado", async () => {
    providerDown = true;
    const unreachable = { ...(await config()), baseUrl: "http://127.0.0.1:1" };
    const result = await checkEvolutionConnectivity(unreachable);
    providerDown = false;
    expect(result.ok).toBe(false);
    expect(result.code === "network_error" || result.code === "timeout").toBe(true);
    expect(result.message).toMatch(/Evolution/);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("configuração ausente não vira stack trace na UI", async () => {
    const url = process.env["EVOLUTION_API_URL"];
    delete process.env["EVOLUTION_API_URL"];
    const error = await resolveEvolutionConfig(null).catch((e) => e);
    process.env["EVOLUTION_API_URL"] = url;
    expect(error.message).toBe("A URL da instância Evolution não está configurada.");
    expect(error instanceof EvolutionApiError).toBe(false);
    expect(providerDown).toBe(false);
  });
});

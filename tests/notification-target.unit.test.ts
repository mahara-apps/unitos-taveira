import { describe, expect, it } from "vitest";
import {
  resolveNotificationTarget,
  resolvePortalNotificationTarget,
} from "@/lib/notification-target";

const POST = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444";

describe("resolveNotificationTarget", () => {
  it("SLA vencido abre o post mesmo com href legado /content", () => {
    const t = resolveNotificationTarget({
      kind: "sla_overdue",
      href: "/content",
      payload: { post_id: POST, stage_id: "x" },
    });
    expect(t).toMatchObject({ to: "/content", search: { post: POST } });
  });

  it("resumo do gestor abre o primeiro post da lista", () => {
    const t = resolveNotificationTarget({
      kind: "sla_overdue_manager",
      href: "/content",
      payload: { post_ids: [POST], count: 3 },
    });
    expect(t.search).toEqual({ post: POST });
  });

  it("prazo de post (source/entity_id) abre o post", () => {
    const t = resolveNotificationTarget({
      kind: "deadline",
      href: `/customers/${CLIENT}?post=${POST}`,
      payload: { source: "post", entity_id: POST },
    });
    expect(t).toMatchObject({ to: "/content", search: { post: POST } });
  });

  it("prazo de tarefa abre a tarefa", () => {
    const t = resolveNotificationTarget({
      kind: "deadline",
      href: `/tasks?task=${TASK}`,
      payload: { source: "task", entity_id: TASK },
    });
    expect(t).toMatchObject({ to: "/tasks", search: { taskId: TASK } });
  });

  it("href legado /tasks?task= é reescrito para taskId", () => {
    const t = resolveNotificationTarget({ kind: "assignment", href: `/tasks?task=${TASK}` });
    expect(t).toMatchObject({ to: "/tasks", search: { taskId: TASK } });
  });

  it("decisão de pauta abre a aba Pauta do cliente com o plano", () => {
    const t = resolveNotificationTarget({
      kind: "approval_decision",
      href: `/customers/${CLIENT}/pauta`,
      payload: { monthly_plan_id: PLAN, client_id: CLIENT },
    });
    expect(t).toMatchObject({
      to: "/customers/$customerId",
      params: { customerId: CLIENT },
      search: { tab: "pauta", planId: PLAN },
      clientId: CLIENT,
    });
  });

  it("href /customers/:id/pauta sem payload cai na aba Pauta", () => {
    const t = resolveNotificationTarget({ kind: "system", href: `/customers/${CLIENT}/pauta` });
    expect(t.search).toMatchObject({ tab: "pauta" });
    expect(t.clientId).toBe(CLIENT);
  });

  it("aba legada é normalizada", () => {
    const t = resolveNotificationTarget({ kind: "system", href: `/customers/${CLIENT}?tab=producao` });
    expect(t.search).toMatchObject({ tab: "trabalho" });
  });

  it("pedido do cliente abre a Área do cliente", () => {
    const t = resolveNotificationTarget({
      kind: "system",
      href: `/inbox?cliente=${CLIENT}`,
      payload: { client_id: CLIENT },
    });
    expect(t).toMatchObject({ to: "/inbox", search: { cliente: CLIENT }, clientId: CLIENT });
  });

  it("aviso sem destino nem payload nunca fica morto", () => {
    expect(resolveNotificationTarget({ kind: "mention" }).to).toBe("/tasks");
    expect(resolveNotificationTarget({ kind: "deadline" }).to).toBe("/calendar");
    expect(resolveNotificationTarget({ kind: "system" }).to).toBe("/notifications");
  });

  it("só com cliente abre a visão geral da ficha", () => {
    const t = resolveNotificationTarget({ kind: "system", payload: { client_id: CLIENT } });
    expect(t).toMatchObject({ to: "/customers/$customerId", search: { tab: "overview" } });
  });

  it("href externo/absurdo não vira rota inválida", () => {
    const t = resolveNotificationTarget({ kind: "system", href: "https://exemplo.com/x" });
    expect(t.to).toBe("/notifications");
  });
});

describe("resolvePortalNotificationTarget", () => {
  it("só aceita rotas do portal", () => {
    expect(resolvePortalNotificationTarget({ href: "/inbox" }, CLIENT)).toBeNull();
    expect(resolvePortalNotificationTarget({ href: "/content?post=x" }, CLIENT)).toBeNull();
  });

  it("mantém o cliente da sessão", () => {
    expect(resolvePortalNotificationTarget({ href: "/area/aprovacoes" }, CLIENT)).toEqual({
      to: "/area/aprovacoes",
      search: { cliente: CLIENT },
    });
  });
});

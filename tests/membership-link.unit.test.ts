import { describe, it, expect } from "vitest";
import { callRpc } from "@/lib/supabase-rpc";
import { invitableRoles, toAssignableRole } from "@/components/settings/team-shared";
import { assertCanManageBrandMember } from "@/lib/access-guard";

/**
 * Regressão do erro real "Cannot read properties of undefined (reading 'rest')":
 * `SupabaseClient.rpc` faz `return this.rest.rpc(...)`. Chamar o método
 * desanexado perde o `this` e quebra em runtime.
 */
describe("callRpc — preserva o contexto do client Supabase", () => {
  const makeClient = () => ({
    rest: {
      rpc: (fn: string, args: Record<string, unknown>) =>
        Promise.resolve({ data: { fn, args }, error: null }),
    },
    rpc(fn: string, args: Record<string, unknown>) {
      // Mesma implementação do supabase-js.
      return (this as unknown as { rest: { rpc: typeof this.rest.rpc } }).rest.rpc(fn, args);
    },
  });

  it("chama a RPC com o client como `this`", async () => {
    const client = makeClient();
    const res = await callRpc(client as never, "link_existing_user_to_brand", {
      _brand_id: "b1",
      _email: "a@b.com",
      _role: "owner",
    });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ fn: "link_existing_user_to_brand" });
  });

  it("a chamada desanexada (bug original) falha com o erro reportado", async () => {
    const client = makeClient();
    const detached = client.rpc as (f: string, a: Record<string, unknown>) => unknown;
    expect(() => detached("x", {})).toThrow(/reading 'rest'/);
  });
});

/**
 * RBAC canônico (espelha `public.can_invite_brand_role`):
 *   super_admin → owner | admin | manager | user
 *   owner/admin → admin | manager | user (nunca owner)
 *   manager     → user
 *   user/client → nenhum
 */
describe("papéis concedíveis por autoridade", () => {
  it("super admin concede todos os papéis internos, inclusive owner", () => {
    expect(invitableRoles("super_admin")).toEqual(["owner", "admin", "manager", "user"]);
  });

  it("owner/admin adicionam Admin, Manager e User — nunca Owner", () => {
    expect(invitableRoles("admin")).toEqual(["admin", "manager", "user"]);
    expect(invitableRoles("admin")).not.toContain("owner");
  });

  it("manager concede apenas user", () => {
    expect(invitableRoles("manager")).toEqual(["user"]);
  });

  it("user e cliente não concedem papéis", () => {
    expect(invitableRoles("user")).toEqual([]);
    expect(invitableRoles("client")).toEqual([]);
    expect(invitableRoles(null)).toEqual([]);
  });

  it("papéis legados normalizam para user, nunca para admin", () => {
    expect(toAssignableRole("editor")).toBe("user");
    expect(toAssignableRole("designer")).toBe("user");
    expect(toAssignableRole("owner")).toBe("owner");
    expect(toAssignableRole("admin")).toBe("admin");
  });
});

/** Gestão de membro existente: papel do alvo importa (Admin não mexe em Owner). */
describe("assertCanManageBrandMember — matriz completa de autoridade", () => {
  const client = (actorAuthority: string | null, targetMemberRole: string | null) =>
    ({
      rest: {
        rpc: (fn: string) =>
          Promise.resolve({
            data: fn === "app_access_role" ? actorAuthority : targetMemberRole,
            error: null,
          }),
      },
      rpc(fn: string, args: Record<string, unknown>) {
        return (this as unknown as { rest: { rpc: (f: string, a: unknown) => unknown } }).rest.rpc(
          fn,
          args,
        );
      },
    }) as never;

  const run = (actor: string | null, target: string | null, next?: string) =>
    assertCanManageBrandMember(client(actor, target), "actor", "brand", "target", next as never);

  it("super admin gerencia qualquer alvo e concede owner", async () => {
    await expect(run("super_admin", "owner", "owner")).resolves.toBeDefined();
  });

  it("owner/admin concedem admin, manager e user", async () => {
    for (const next of ["admin", "manager", "user"]) {
      await expect(run("admin", "user", next)).resolves.toBe("admin");
    }
  });

  it("owner/admin não concedem owner", async () => {
    await expect(run("admin", "user", "owner")).rejects.toThrow(/super admin/);
  });

  it("admin não altera o Owner da marca", async () => {
    await expect(run("admin", "owner", "manager")).rejects.toThrow(/Owner/);
  });

  it("manager concede apenas user", async () => {
    await expect(run("manager", "user", "user")).resolves.toBe("manager");
    await expect(run("manager", "user", "admin")).rejects.toThrow(/forbidden/);
    await expect(run("manager", "user", "manager")).rejects.toThrow(/forbidden/);
    await expect(run("manager", "user", "owner")).rejects.toThrow(/super admin/);
  });

  it("manager não gerencia admin nem manager", async () => {
    await expect(run("manager", "admin", "user")).rejects.toThrow(/apenas membros User/);
    await expect(run("manager", "manager", "user")).rejects.toThrow(/apenas membros User/);
  });

  it("user e client não gerenciam membros", async () => {
    await expect(run("user", "user", "user")).rejects.toThrow(/forbidden/);
    await expect(run("client", "user", "user")).rejects.toThrow(/forbidden/);
    await expect(run(null, "user", "user")).rejects.toThrow(/forbidden/);
  });
});

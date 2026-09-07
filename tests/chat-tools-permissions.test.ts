import { describe, expect, it } from "vitest";
import { buildChatTools } from "@/lib/brain/chat-gateway/tools.server";
import {
  emptyModulePermissions,
  fullModulePermissions,
  type ModulePermissions,
} from "@/lib/module-permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeSupabase = {} as any;
const ctx = { brandId: "b1", clientId: null, userId: "u1", module: "chat" } as never;

const build = (perms: ModulePermissions | null) =>
  Object.keys(buildChatTools(fakeSupabase, ctx, [], perms)).sort();

describe("buildChatTools — gate por permissão de módulo", () => {
  it("sem permissões não expõe nenhuma ferramenta (fail-closed)", () => {
    expect(build(null)).toEqual([]);
    expect(build(emptyModulePermissions())).toEqual([]);
  });

  it("nível total cobre a operação inteira", () => {
    const names = build(fullModulePermissions());
    for (const expected of [
      "search_clients",
      "list_projects",
      "list_tasks",
      "create_task",
      "search_content",
      "list_calendar",
      "list_monthly_plans",
      "list_pending_approvals",
      "get_briefing_status",
      "list_client_requests",
      "timesheet_summary",
      "list_team",
      "list_connections_status",
      "brain_recall",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("criar tarefa exige nível total no módulo de tarefas", () => {
    const view = { ...emptyModulePermissions(), tasks: "view" } as ModulePermissions;
    expect(build(view)).toContain("list_tasks");
    expect(build(view)).not.toContain("create_task");

    const own = { ...emptyModulePermissions(), tasks: "own" } as ModulePermissions;
    expect(build(own)).not.toContain("create_task");

    const full = { ...emptyModulePermissions(), tasks: "full" } as ModulePermissions;
    expect(build(full)).toContain("create_task");
  });

  it("módulo em nenhum não aparece mesmo com outros liberados", () => {
    const perms = {
      ...emptyModulePermissions(),
      clients: "full",
      connections: "none",
    } as ModulePermissions;
    const names = build(perms);
    expect(names).toContain("search_clients");
    expect(names).not.toContain("list_connections_status");
  });
});

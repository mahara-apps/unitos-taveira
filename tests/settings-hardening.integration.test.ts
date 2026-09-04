/**
 * FASE 1 — Blindagem do Settings.
 *
 * Cobre enforcement real (RLS + regra canônica de papel) para:
 * - Auditoria (listSystemLogs → assertAdminAuthority);
 * - SLA de etapa (content_pipeline_stages: leitura de membros, escrita admin level);
 * - Identidade da agência (brands UPDATE alinhado a super_admin/admin/manager).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, seed, type Fixture } from "./helpers/fixtures";
import { assertAdminAuthority } from "../src/lib/access-guard";

let fx: Fixture | null = null;
let pipelineId = "";
let stageId = "";
let otherStageId = "";

beforeAll(async () => {
  fx = await seed();

  const p = await admin
    .from("content_pipelines")
    .insert([
      { brand_id: fx.brandId, client_id: fx.clientA, name: "QA Pipeline", slug: "qa-pipeline" },
      {
        brand_id: fx.otherBrandId,
        client_id: fx.otherBrandClient,
        name: "QA Pipeline Outra",
        slug: "qa-pipeline-outra",
      },
    ])
    .select("id, brand_id");
  if (p.error) throw new Error(`pipelines: ${p.error.message}`);
  pipelineId = p.data.find((r) => r.brand_id === fx!.brandId)!.id as string;
  const otherPipelineId = p.data.find((r) => r.brand_id === fx!.otherBrandId)!.id as string;

  const s = await admin
    .from("content_pipeline_stages")
    .insert([
      { pipeline_id: pipelineId, key: "qa", label: "Etapa QA", color: "#888888", position: 1 },
      {
        pipeline_id: otherPipelineId,
        key: "qa",
        label: "Etapa QA Outra",
        color: "#888888",
        position: 1,
      },
    ])
    .select("id, pipeline_id");
  if (s.error) throw new Error(`stages: ${s.error.message}`);
  stageId = s.data.find((r) => r.pipeline_id === pipelineId)!.id as string;
  otherStageId = s.data.find((r) => r.pipeline_id === otherPipelineId)!.id as string;
}, 120_000);

afterAll(async () => {
  if (fx) {
    await admin.from("content_pipeline_stages").delete().in("id", [stageId, otherStageId]);
    await admin.from("content_pipelines").delete().in("brand_id", [fx.brandId, fx.otherBrandId]);
  }
  await cleanup(fx);
}, 120_000);

describe("Auditoria (logs) — enforcement de papel no servidor", () => {
  it("USER é bloqueado", async () => {
    await expect(assertAdminAuthority(fx!.userA.client, fx!.userA.id, fx!.brandId)).rejects.toThrow(
      /Forbidden/,
    );
  });

  it("user sem vínculo também é bloqueado", async () => {
    await expect(
      assertAdminAuthority(fx!.userNoLink.client, fx!.userNoLink.id, fx!.brandId),
    ).rejects.toThrow(/Forbidden/);
  });

  it("portal_client é bloqueado", async () => {
    await expect(
      assertAdminAuthority(fx!.userPortal.client, fx!.userPortal.id, fx!.brandId),
    ).rejects.toThrow(/Forbidden/);
  });

  it("manager e admin (owner) passam", async () => {
    await expect(
      assertAdminAuthority(fx!.userManager.client, fx!.userManager.id, fx!.brandId),
    ).resolves.toBe("manager");
    await expect(
      assertAdminAuthority(fx!.userOwner.client, fx!.userOwner.id, fx!.brandId),
    ).resolves.toBe("admin");
  });

  it("cross-brand: manager de outra marca não vira admin na marca alheia", async () => {
    // userManager só é membro de fx.brandId; em otherBrandId não tem papel.
    await expect(
      assertAdminAuthority(fx!.userManager.client, fx!.userManager.id, fx!.otherBrandId),
    ).rejects.toThrow(/Forbidden/);
  });
});

describe("SLA de etapa (content_pipeline_stages)", () => {
  it("user lê etapas da própria marca (comportamento preservado)", async () => {
    const { data, error } = await fx!.userA.client
      .from("content_pipeline_stages")
      .select("id, label")
      .eq("id", stageId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("user não altera etapa", async () => {
    const { data, error } = await fx!.userA.client
      .from("content_pipeline_stages")
      .update({ label: "Hack User", sla_days: 9 })
      .eq("id", stageId)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    const check = await admin
      .from("content_pipeline_stages")
      .select("label")
      .eq("id", stageId)
      .single();
    expect(check.data?.label).toBe("Etapa QA");
  });

  it("user não cria nem remove etapa", async () => {
    const ins = await fx!.userA.client
      .from("content_pipeline_stages")
      .insert({
        pipeline_id: pipelineId,
        key: "nova",
        label: "Nova User",
        color: "#888888",
        position: 9,
      })
      .select("id");
    expect(ins.error).not.toBeNull();

    const del = await fx!.userA.client
      .from("content_pipeline_stages")
      .delete()
      .eq("id", stageId)
      .select("id");
    expect(del.error).toBeNull();
    expect(del.data ?? []).toHaveLength(0);
  });

  it("admin altera etapa da própria marca; manager só com cliente atribuído", async () => {
    const asAdmin = await fx!.userOwner.client
      .from("content_pipeline_stages")
      .update({ label: "Etapa QA", sla_days: 3 })
      .eq("id", stageId)
      .select("id");
    expect(asAdmin.error).toBeNull();
    expect(asAdmin.data?.length).toBe(1);

    // Fase 1 RBAC: pipeline pertence ao clientA; manager sem vínculo não alcança.
    const denied = await fx!.userManager.client
      .from("content_pipeline_stages")
      .update({ label: "Etapa Manager" })
      .eq("id", stageId)
      .select("id");
    expect(denied.error).toBeNull();
    expect(denied.data ?? []).toHaveLength(0);

    const link = await admin.from("client_members").insert({
      brand_id: fx!.brandId,
      client_id: fx!.clientA,
      user_id: fx!.userManager.id,
      role: "manager",
    });
    expect(link.error).toBeNull();

    const allowed = await fx!.userManager.client
      .from("content_pipeline_stages")
      .update({ label: "Etapa QA", sla_days: 3 })
      .eq("id", stageId)
      .select("id");
    expect(allowed.error).toBeNull();
    expect(allowed.data?.length).toBe(1);

    await admin
      .from("client_members")
      .delete()
      .eq("client_id", fx!.clientA)
      .eq("user_id", fx!.userManager.id);
  });

  it("cross-brand: manager não altera etapa de outra marca", async () => {
    const { data, error } = await fx!.userManager.client
      .from("content_pipeline_stages")
      .update({ label: "Hack Cross" })
      .eq("id", otherStageId)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("Identidade da agência (brands)", () => {
  it("user não altera dados cadastrais", async () => {
    const { data, error } = await fx!.userA.client
      .from("brands")
      .update({ razao_social: "Hack LTDA" })
      .eq("id", fx!.brandId)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("manager não altera dados cadastrais (regra canônica atual: admin/owner)", async () => {
    const { data, error } = await fx!.userManager.client
      .from("brands")
      .update({ razao_social: "QA Manager LTDA" })
      .eq("id", fx!.brandId)
      .select("id, razao_social");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });


  it("admin (owner) altera dados cadastrais", async () => {
    const { data, error } = await fx!.userOwner.client
      .from("brands")
      .update({ razao_social: "QA Owner LTDA" })
      .eq("id", fx!.brandId)
      .select("id, razao_social");
    expect(error).toBeNull();
    expect(data?.[0]?.razao_social).toBe("QA Owner LTDA");
  });

  it("cross-brand: manager não altera outra marca", async () => {
    const { data, error } = await fx!.userManager.client
      .from("brands")
      .update({ razao_social: "Hack Cross LTDA" })
      .eq("id", fx!.otherBrandId)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

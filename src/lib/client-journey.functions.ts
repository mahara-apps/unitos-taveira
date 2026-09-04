import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandAdmin, type RpcClient } from "@/lib/access-guard";

export const JOURNEY_STAGES = [
  "onboarding",
  "ativacao",
  "operacao",
  "expansao",
  "renovacao",
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export const JOURNEY_STAGE_LABEL: Record<JourneyStage, string> = {
  onboarding: "Onboarding",
  ativacao: "Ativação",
  operacao: "Operação",
  expansao: "Expansão",
  renovacao: "Renovação",
};

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  encerrado: "Encerrado",
};

const StageEnum = z.enum(JOURNEY_STAGES);
const StatusEnum = z.enum(["ativo", "pausado", "encerrado"]);

export type ClientAccount = {
  id: string;
  brand_id: string;
  name: string;
  owner_user_id: string | null;
  monthly_contract_value: number | null;
  margin_percent: number | null;
  contract_start_date: string | null;
  contract_renewal_date: string | null;
  contract_status: string;
  internal_notes: string | null;
  journey_stage: JourneyStage;
};

export type JourneyEvent = {
  id: string;
  brand_id: string;
  client_id: string;
  from_stage: string | null;
  to_stage: string;
  note: string | null;
  project_id: string | null;
  moved_by: string | null;
  moved_by_name: string | null;
  project_name: string | null;
  created_at: string;
};

export type StageTemplateMapping = {
  stage: JourneyStage;
  project_template_id: string | null;
  project_template_name: string | null;
};

export const getClientAccountFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: client, error } = await supabase
      .from("clients")
      .select(
        "id, brand_id, name, owner_user_id, monthly_contract_value, margin_percent, contract_start_date, contract_renewal_date, contract_status, internal_notes, journey_stage",
      )
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (error) throw error;
    if (!client) throw new Error("Cliente não encontrado.");

    const { data: events, error: evErr } = await supabase
      .from("client_journey_events")
      .select(
        "id, brand_id, client_id, from_stage, to_stage, note, project_id, moved_by, created_at",
      )
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (evErr) throw evErr;

    const moverIds = Array.from(
      new Set((events ?? []).map((e) => e.moved_by).filter(Boolean) as string[]),
    );
    const projectIds = Array.from(
      new Set((events ?? []).map((e) => e.project_id).filter(Boolean) as string[]),
    );
    const [profilesRes, projectsRes, mappingsRes] = await Promise.all([
      moverIds.length
        ? supabase.from("user_profiles").select("id, full_name").in("id", moverIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? supabase.from("projects").select("id, name").in("id", projectIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("brand_journey_stage_templates")
        .select("stage, project_template_id, project_templates(name)")
        .eq("brand_id", data.brandId),
    ]);
    if (profilesRes.error) throw profilesRes.error;
    if (projectsRes.error) throw projectsRes.error;
    if (mappingsRes.error) throw mappingsRes.error;

    const nameById = new Map(
      (profilesRes.data ?? []).map((p: { id: string; full_name: string | null }) => [
        p.id,
        p.full_name,
      ]),
    );
    const projById = new Map(
      (projectsRes.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]),
    );

    const timeline: JourneyEvent[] = (events ?? []).map((e) => ({
      ...e,
      moved_by_name: e.moved_by ? (nameById.get(e.moved_by) ?? null) : null,
      project_name: e.project_id ? (projById.get(e.project_id) ?? null) : null,
    }));

    const mappings: StageTemplateMapping[] = JOURNEY_STAGES.map((s) => {
      const row = (mappingsRes.data ?? []).find((r: { stage: string }) => r.stage === s) as
        | {
            stage: string;
            project_template_id: string;
            project_templates: { name: string } | null;
          }
        | undefined;
      return {
        stage: s,
        project_template_id: row?.project_template_id ?? null,
        project_template_name: row?.project_templates?.name ?? null,
      };
    });

    return {
      account: client as ClientAccount,
      timeline,
      stageMappings: mappings,
    };
  });

const UpdateInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  patch: z.object({
    monthly_contract_value: z.number().nullable().optional(),
    margin_percent: z.number().nullable().optional(),
    contract_start_date: z.string().nullable().optional(),
    contract_renewal_date: z.string().nullable().optional(),
    contract_status: StatusEnum.optional(),
    internal_notes: z.string().nullable().optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
  }),
});

async function assertAdmin(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  brandId: string,
  userId: string,
) {
  // Autoridade canônica (super_admin, owner/ADMIN, manager do workspace).
  try {
    await assertBrandAdmin(supabase as unknown as RpcClient, userId, brandId);
  } catch {
    throw new Error("Apenas admin/manager pode editar a gestão da conta.");
  }
}

export const updateClientAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.brandId, context.userId);
    const { error } = await context.supabase
      .from("clients")
      .update(data.patch)
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId);
    if (error) throw error;
    return { ok: true };
  });

const MoveInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  toStage: StageEnum,
  note: z.string().max(500).optional(),
  createProject: z.boolean().optional(),
  projectTemplateId: z.string().uuid().optional(),
});

export const moveClientJourneyStageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MoveInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, data.brandId, userId);

    const { data: client, error: cErr } = await supabase
      .from("clients")
      .select("id, name, journey_stage")
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!client) throw new Error("Cliente não encontrado.");

    const fromStage = client.journey_stage as string | null;

    // 1. update client stage
    const { error: upErr } = await supabase
      .from("clients")
      .update({ journey_stage: data.toStage })
      .eq("id", data.clientId);
    if (upErr) throw upErr;

    // 2. optionally create project from template
    let projectId: string | null = null;
    let projectName: string | null = null;
    if (data.createProject) {
      let tplId = data.projectTemplateId ?? null;
      if (!tplId) {
        const { data: map } = await supabase
          .from("brand_journey_stage_templates")
          .select("project_template_id")
          .eq("brand_id", data.brandId)
          .eq("stage", data.toStage)
          .maybeSingle();
        tplId = map?.project_template_id ?? null;
      }
      if (tplId) {
        projectName = `${client.name} — ${
          {
            onboarding: "Onboarding",
            ativacao: "Ativação",
            operacao: "Operação",
            expansao: "Expansão",
            renovacao: "Renovação",
          }[data.toStage]
        }`;
        const { data: pid, error: rpcErr } = await supabase.rpc("instantiate_project_template", {
          _template_id: tplId,
          _brand_id: data.brandId,
          _client_id: data.clientId,
          _project_name: projectName,
        });
        if (rpcErr) throw rpcErr;
        projectId = (pid as unknown as string) ?? null;
      }
    }

    // 3. journey event
    const { error: evErr } = await supabase.from("client_journey_events").insert({
      brand_id: data.brandId,
      client_id: data.clientId,
      from_stage: fromStage,
      to_stage: data.toStage,
      note: data.note ?? null,
      project_id: projectId,
      moved_by: userId,
    });
    if (evErr) throw evErr;

    // 4. brain event (best-effort)
    try {
      const { brain } = await import("@/lib/brain/api");
      await brain.registerEvent(
        {
          supabase,
          userId,
          brandId: data.brandId,
          clientId: data.clientId,
        } as unknown as import("@/lib/brain/core").BrainContext,
        {
          source_module: "customers",
          event_type: "client.journey.changed",
          payload: {
            from_stage: fromStage,
            to_stage: data.toStage,
            project_id: projectId,
            note: data.note ?? null,
          },
        },
      );
    } catch (e) {
      console.error("[client-journey] brain.registerEvent failed", e);
    }

    return { ok: true, projectId, projectName };
  });

const SetMappingInput = z.object({
  brandId: z.string().uuid(),
  stage: StageEnum,
  projectTemplateId: z.string().uuid().nullable(),
});

export const setStageTemplateMappingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetMappingInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.brandId, context.userId);
    if (data.projectTemplateId == null) {
      const { error } = await context.supabase
        .from("brand_journey_stage_templates")
        .delete()
        .eq("brand_id", data.brandId)
        .eq("stage", data.stage);
      if (error) throw error;
      return { ok: true };
    }
    const { error } = await context.supabase.from("brand_journey_stage_templates").upsert(
      {
        brand_id: data.brandId,
        stage: data.stage,
        project_template_id: data.projectTemplateId,
      },
      { onConflict: "brand_id,stage" },
    );
    if (error) throw error;
    return { ok: true };
  });

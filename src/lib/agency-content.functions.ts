import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stageSlaHours } from "@/lib/content.functions";

/**
 * Visão unificada de conteúdos — modo Agência (cross-client).
 * Reaproveita tabelas existentes; sem migração. Restrito no frontend a
 * admins (via useAccessRole). Não substitui o Kanban por cliente.
 */

export type AgencyPostRow = {
  id: string;
  title: string;
  cover_url: string | null;
  stage_id: string | null;
  stage_label: string;
  stage_color: string | null;
  stage_key: string;
  pipeline_id: string | null;
  client_id: string;
  client_name: string;
  scheduled_at: string | null;
  updated_at: string;
  created_at: string;
  stage_entered_at: string | null;
  hours_in_stage: number;
  sla_hours: number | null;
  sla_status: "none" | "on_track" | "at_risk" | "overdue";
  hours_overdue: number;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
  priority: string | null;
  channels: string[];
};

export type AgencyStageBucket = {
  key: string;
  label: string;
  color: string | null;
  count: number;
  overdue_count: number;
  at_risk_count: number;
  order: number;
};

export type AgencyStalledClient = {
  client_id: string;
  client_name: string;
  last_move_at: string | null;
  days_stalled: number;
  count: number;
};

export type AgencyContentSnapshot = {
  posts: AgencyPostRow[];
  buckets: AgencyStageBucket[];
  kpis: {
    inProduction: number;
    awaitingApproval: number;
    overdue: number;
    atRisk: number;
    stalledClients: number;
  };
  stalledClients: AgencyStalledClient[];
  clients: Array<{ id: string; name: string }>;
};

// Ordem canônica de etapas (para colunas). Nomes normalizados em minúsculas.
const CANONICAL_ORDER = [
  "ideia",
  "briefing",
  "produção",
  "producao",
  "roteiro",
  "design",
  "revisão",
  "revisao",
  "aprovação",
  "aprovacao",
  "aprovado",
  "agendado",
];

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function orderOf(label: string): number {
  const i = CANONICAL_ORDER.indexOf(normalizeLabel(label));
  return i === -1 ? 900 : i;
}

export const listAgencyContentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientIds: z.array(z.string().uuid()).optional(),
        stalledDays: z.number().int().min(1).max(60).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<AgencyContentSnapshot> => {
    const { supabase } = context;
    const nowMs = Date.now();
    const stalledDays = data.stalledDays ?? 3;

    // 1. Pipelines do brand
    const { data: pipelines } = await supabase
      .from("content_pipelines")
      .select("id")
      .eq("brand_id", data.brandId);
    const pipeIds = (pipelines ?? []).map((p) => p.id as string);
    if (pipeIds.length === 0) {
      return {
        posts: [],
        buckets: [],
        kpis: { inProduction: 0, awaitingApproval: 0, overdue: 0, atRisk: 0, stalledClients: 0 },
        stalledClients: [],
        clients: [],
      };
    }

    // 2. Stages + Clients em paralelo
    const [stagesRes, clientsRes] = await Promise.all([
      supabase
        .from("content_pipeline_stages")
        .select("id, pipeline_id, key, label, color, position, is_terminal, sla_hours, sla_days")
        .in("pipeline_id", pipeIds),
      supabase.from("clients").select("id, name").eq("brand_id", data.brandId),
    ]);
    const stages = (stagesRes.data ?? []) as Array<{
      id: string;
      pipeline_id: string;
      key: string;
      label: string;
      color: string | null;
      position: number;
      is_terminal: boolean;
      sla_hours: number | null;
      sla_days: number | null;
    }>;
    const stageMap = new Map(stages.map((s) => [s.id, s]));
    const nonTerminalIds = stages.filter((s) => !s.is_terminal).map((s) => s.id);
    const clientMap = new Map(
      ((clientsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c]),
    );

    if (nonTerminalIds.length === 0) {
      return {
        posts: [],
        buckets: [],
        kpis: { inProduction: 0, awaitingApproval: 0, overdue: 0, atRisk: 0, stalledClients: 0 },
        stalledClients: [],
        clients: Array.from(clientMap.values()),
      };
    }

    // 3. Posts ativos
    let postsQ = supabase
      .from("posts")
      .select(
        "id, title, cover_url, stage_id, pipeline_id, client_id, scheduled_at, updated_at, created_at, stage_entered_at, assignee_id, priority, channels",
      )
      .eq("brand_id", data.brandId)
      .is("deleted_at", null)
      .in("stage_id", nonTerminalIds)
      .limit(2000);
    if (data.clientIds && data.clientIds.length > 0) {
      postsQ = postsQ.in("client_id", data.clientIds);
    }
    const { data: postsData, error } = await postsQ;
    if (error) throw error;
    const posts = (postsData ?? []) as Array<{
      id: string;
      title: string | null;
      cover_url: string | null;
      stage_id: string | null;
      pipeline_id: string | null;
      client_id: string;
      scheduled_at: string | null;
      updated_at: string;
      created_at: string;
      stage_entered_at: string | null;
      assignee_id: string | null;
      priority: string | null;
      channels: string[] | null;
    }>;

    // 4. Perfis dos responsáveis
    const assigneeIds = Array.from(
      new Set(posts.map((p) => p.assignee_id).filter(Boolean) as string[]),
    );
    const profMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
    if (assigneeIds.length > 0) {
      const { data: profs } = await supabase
        .from("user_profiles")
        .select("id, full_name, avatar_url")
        .in("id", assigneeIds);
      for (const p of (profs ?? []) as Array<{
        id: string;
        full_name: string | null;
        avatar_url: string | null;
      }>) {
        profMap.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url });
      }
    }

    // 5. Montar linhas + agregados
    const rows: AgencyPostRow[] = [];
    const lastMoveByClient = new Map<string, number>();
    for (const p of posts) {
      const s = p.stage_id ? stageMap.get(p.stage_id) : null;
      if (!s) continue;
      const slaH = stageSlaHours(s);
      const enteredMs = p.stage_entered_at ? new Date(p.stage_entered_at).getTime() : null;
      const hoursIn = enteredMs != null ? Math.max(0, (nowMs - enteredMs) / 3_600_000) : 0;
      let status: AgencyPostRow["sla_status"] = "none";
      let hoursOverdue = 0;
      if (slaH && enteredMs != null) {
        const progress = hoursIn / slaH;
        if (progress >= 1) {
          status = "overdue";
          hoursOverdue = Math.max(0, hoursIn - slaH);
        } else if (progress >= 0.8) status = "at_risk";
        else status = "on_track";
      }
      const prof = p.assignee_id ? profMap.get(p.assignee_id) : null;
      const cli = clientMap.get(p.client_id);
      const row: AgencyPostRow = {
        id: p.id,
        title: p.title || "Sem título",
        cover_url: p.cover_url,
        stage_id: p.stage_id,
        stage_label: s.label,
        stage_color: s.color,
        stage_key: s.key,
        pipeline_id: p.pipeline_id,
        client_id: p.client_id,
        client_name: cli?.name ?? "—",
        scheduled_at: p.scheduled_at,
        updated_at: p.updated_at,
        created_at: p.created_at,
        stage_entered_at: p.stage_entered_at,
        hours_in_stage: hoursIn,
        sla_hours: slaH,
        sla_status: status,
        hours_overdue: hoursOverdue,
        assignee_id: p.assignee_id,
        assignee_name: prof?.full_name ?? null,
        assignee_avatar: prof?.avatar_url ?? null,
        priority: p.priority,
        channels: p.channels ?? [],
      };
      rows.push(row);
      const moveTs = enteredMs ?? new Date(p.updated_at).getTime();
      const prev = lastMoveByClient.get(p.client_id) ?? 0;
      if (moveTs > prev) lastMoveByClient.set(p.client_id, moveTs);
    }

    // 6. Buckets por label normalizado
    const bucketMap = new Map<string, AgencyStageBucket>();
    for (const r of rows) {
      const key = normalizeLabel(r.stage_label);
      const b = bucketMap.get(key) ?? {
        key,
        label: r.stage_label,
        color: r.stage_color,
        count: 0,
        overdue_count: 0,
        at_risk_count: 0,
        order: orderOf(r.stage_label),
      };
      b.count += 1;
      if (r.sla_status === "overdue") b.overdue_count += 1;
      if (r.sla_status === "at_risk") b.at_risk_count += 1;
      bucketMap.set(key, b);
    }
    const buckets = Array.from(bucketMap.values()).sort(
      (a, b) => a.order - b.order || a.label.localeCompare(b.label),
    );

    // 7. Clientes parados
    const stalledMs = stalledDays * 86_400_000;
    const countsByClient = new Map<string, number>();
    for (const r of rows) {
      countsByClient.set(r.client_id, (countsByClient.get(r.client_id) ?? 0) + 1);
    }
    const stalledClients: AgencyStalledClient[] = [];
    for (const [clientId, lastMs] of lastMoveByClient.entries()) {
      const diff = nowMs - lastMs;
      if (diff >= stalledMs) {
        stalledClients.push({
          client_id: clientId,
          client_name: clientMap.get(clientId)?.name ?? "—",
          last_move_at: new Date(lastMs).toISOString(),
          days_stalled: Math.floor(diff / 86_400_000),
          count: countsByClient.get(clientId) ?? 0,
        });
      }
    }
    stalledClients.sort((a, b) => b.days_stalled - a.days_stalled);

    const kpis = {
      inProduction: rows.length,
      awaitingApproval: rows.filter(
        (r) =>
          normalizeLabel(r.stage_label).includes("aprova") ||
          normalizeLabel(r.stage_label).includes("revis"),
      ).length,
      overdue: rows.filter((r) => r.sla_status === "overdue").length,
      atRisk: rows.filter((r) => r.sla_status === "at_risk").length,
      stalledClients: stalledClients.length,
    };

    return {
      posts: rows,
      buckets,
      kpis,
      stalledClients,
      clients: Array.from(clientMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

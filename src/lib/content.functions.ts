import { normalizeContentFormat } from "@/lib/content-formats";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { displayName } from "@/lib/identity";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
// Brain-First: acessos ao Brain só via API pública. Este módulo consome o
// helper de ingest via `@/lib/brain/api` — nunca toca `brain_*` diretamente.
import { brain } from "@/lib/brain/api";
import {
  syncPostPlacements,
  deriveChannelsFromDestinations,
  deriveTargetConnectionIds,
  type PlacementDestination,
} from "@/lib/placements.server";
import { resolveLegacyStage } from "@/lib/post-stage.server";
import { assertScheduleLead } from "@/lib/schedule-rules";

const DestinationSchema = z.object({
  connectionId: z.string().uuid(),
  channel: z.string().min(1).max(40),
  format: z.enum(["feed", "stories", "reels", "carrossel"]),
  copyOverride: z.string().nullable().optional(),
});

/** Fire-and-forget ingest via Brain API (best-effort; nunca lança). */
function ingestBrainQuiet(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  brandId: string,
  eventType: string,
  sourceModule: string,
  payload: Record<string, unknown>,
) {
  brain.ingestQuiet(supabase, brandId, eventType, sourceModule, payload);
}

export const STAGE_COLORS = [
  "muted",
  "indigo",
  "violet",
  "amber",
  "emerald",
  "sky",
  "rose",
  "cyan",
] as const;
export type StageColor = (typeof STAGE_COLORS)[number];

// ---------- Assignees ----------
export const listBrandAssigneesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ brandId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: members, error } = await context.supabase
      .from("brand_members")
      .select("user_id, role")
      .eq("brand_id", data.brandId);
    if (error) throw error;
    const ids = (members ?? []).map((m) => m.user_id as string);
    if (ids.length === 0)
      return [] as Array<{
        id: string;
        name: string;
        email: string | null;
        avatar_url: string | null;
        role: string;
      }>;
    const { data: profiles } = await context.supabase
      .from("user_profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    const profMap = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    return (members ?? [])
      .map((m) => {
        const p = profMap.get(m.user_id as string);
        return {
          id: m.user_id as string,
          name: displayName({
            full_name: (p?.full_name as string | null) ?? null,
            email: (p?.email as string | null) ?? null,
          }),
          email: (p?.email as string | null) ?? null,
          avatar_url: (p?.avatar_url as string | null) ?? null,
          role: (m.role as string) ?? "member",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

const DEFAULT_STAGES: Array<{
  key: string;
  label: string;
  color: StageColor;
  is_terminal?: boolean;
}> = [
  { key: "briefing", label: "Ideia", color: "muted" },
  { key: "writing", label: "Produção", color: "indigo" },
  { key: "design", label: "Design", color: "violet" },
  { key: "review", label: "Revisão", color: "amber" },
  { key: "approved", label: "Aprovado", color: "emerald" },
  { key: "scheduled", label: "Agendado", color: "sky", is_terminal: true },
];

// ---------- Types ----------
export type Pipeline = {
  id: string;
  brand_id: string;
  client_id: string;
  name: string;
  slug: string;
  is_default: boolean;
  position: number;
  post_count: number;
  color?: string | null;
  description?: string | null;
  icon?: string | null;
};

export type PipelineStage = {
  id: string;
  pipeline_id: string;
  key: string;
  label: string;
  color: StageColor;
  position: number;
  is_terminal: boolean;
  hide_in_portal?: boolean | null;
  enables_approval_link?: boolean | null;
  sla_days?: number | null;
  sla_hours?: number | null;
};

export type BoardPost = {
  id: string;
  title: string;
  copy: string | null;
  channels: string[];
  scheduled_at: string | null;
  published_at: string | null;
  assignee_id: string | null;
  cover_url: string | null;
  stage_id: string | null;
  pipeline_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  brand_id: string;
  client_id: string;
  review_status?: string | null;
  reference_media?: Array<{
    path: string;
    name?: string;
    type?: string;
    size?: number;
    thumb_path?: string | null;
    pruned?: boolean | null;
  }> | null;
  design_brief?: string | null;
  ai_phase?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  rework_notes?: string | null;
  priority?: string | null;
  format?: string | null;
  tags?: string[] | null;
  placements?: Array<{ format: string; is_primary?: boolean | null }> | null;
  target_connection_ids?: string[] | null;
  visible_in_portal?: boolean | null;
  internal_briefing?: string | null;
  client_briefing?: string | null;
  script?: ScriptScene[] | null;
  references?: PostReference[] | null;
  project_id?: string | null;
  monthly_plan_topic_id?: string | null;
  /** Agenda proposta pela pauta (reserva de data, não publica). */
  proposed_at?: string | null;
  schedule_status?: string | null;
  schedule_approved_at?: string | null;
  schedule_client_comment?: string | null;
  remind_at?: string | null;
  assignees?: string[] | null;
  stage_entered_at?: string | null;
  is_overdue?: boolean;
  days_overdue?: number;
  sla_status?: "none" | "on_track" | "at_risk" | "overdue";
  sla_progress?: number;
  sla_hours?: number | null;
  hours_in_stage?: number;
  hours_overdue?: number;
};

export type ScriptScene = {
  cena: number;
  tempo?: string;
  narrador?: string;
  fala?: string;
  observacao?: string;
};

export type PostReference = {
  id: string;
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  visible_in_portal?: boolean;
};

export type Board = {
  pipeline: Pipeline;
  stages: PipelineStage[];
  posts: BoardPost[];
};

/** Resolve SLA em horas para um stage (usa sla_hours; fallback: sla_days*24). */
export function stageSlaHours(s: Pick<PipelineStage, "sla_hours" | "sla_days">): number | null {
  if (s.sla_hours != null && s.sla_hours > 0) return s.sla_hours;
  if (s.sla_days != null && s.sla_days > 0) return s.sla_days * 24;
  return null;
}

/**
 * Anota SLA em cada post: status (on_track / at_risk / overdue / none),
 * progresso (0..1+), horas no stage e horas de atraso.
 * Mantém `is_overdue` e `days_overdue` para compat.
 */
export function annotateOverdue(posts: BoardPost[], stages: PipelineStage[]): BoardPost[] {
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const now = Date.now();
  return posts.map((p) => {
    const s = p.stage_id ? stageMap.get(p.stage_id) : null;
    const slaH = s ? stageSlaHours(s) : null;
    if (!s || s.is_terminal || !slaH || !p.stage_entered_at) {
      return {
        ...p,
        is_overdue: false,
        days_overdue: 0,
        sla_status: "none",
        sla_progress: 0,
        sla_hours: null,
        hours_in_stage: 0,
        hours_overdue: 0,
      };
    }
    const enteredAt = new Date(p.stage_entered_at).getTime();
    const hoursIn = (now - enteredAt) / 3_600_000;
    const progress = hoursIn / slaH;
    const hoursOverdue = Math.max(0, hoursIn - slaH);
    const status: "on_track" | "at_risk" | "overdue" =
      progress >= 1 ? "overdue" : progress >= 0.8 ? "at_risk" : "on_track";
    return {
      ...p,
      is_overdue: status === "overdue",
      days_overdue: Math.max(0, Math.floor(hoursOverdue / 24)),
      sla_status: status,
      sla_progress: progress,
      sla_hours: slaH,
      hours_in_stage: hoursIn,
      hours_overdue: hoursOverdue,
    };
  });
}

// ---------- SLA snapshot (analytics) ----------

export type SlaSnapshot = {
  activeOverdue: number;
  byUser: Array<{ user_id: string; full_name: string; avatar_url: string | null; overdue: number }>;
  byStage: Array<{ stage_id: string; label: string; sla_hours: number; overdue: number }>;
};

const SlaSnapshotInput = z.object({
  brandId: z.string().uuid(),
  /** Cliente ativo (escopo da conta conectada selecionada). */
  clientId: z.string().uuid().nullish(),
  clientIds: z.array(z.string().uuid()).optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
  projectIds: z.array(z.string().uuid()).optional(),
  channels: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export const slaSnapshotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SlaSnapshotInput.parse(i))
  .handler(async ({ data, context }): Promise<SlaSnapshot> => {
    const { data: pipes } = await context.supabase
      .from("content_pipelines")
      .select("id")
      .eq("brand_id", data.brandId);
    const pipeIds = (pipes ?? []).map((p) => p.id as string);
    if (pipeIds.length === 0) return { activeOverdue: 0, byUser: [], byStage: [] };

    const { data: stages } = await context.supabase
      .from("content_pipeline_stages")
      .select("id,label,sla_days,sla_hours,is_terminal")
      .in("pipeline_id", pipeIds)
      .eq("is_terminal", false);
    const withSla = (stages ?? [])
      .map((s) => ({ ...s, _hours: stageSlaHours(s as PipelineStage) }))
      .filter((s) => s._hours != null) as Array<{ id: string; label: string; _hours: number }>;
    if (withSla.length === 0) return { activeOverdue: 0, byUser: [], byStage: [] };

    // Escopo: cliente ativo tem prioridade sobre a lista de clientes do filtro.
    const clientIds = data.clientId ? [data.clientId] : (data.clientIds ?? []).filter(Boolean);
    const assigneeIds = data.assigneeIds ?? [];
    const projectIds = data.projectIds ?? [];
    const channels = (data.channels ?? []).filter(Boolean);
    const tags = (data.tags ?? []).filter(Boolean);

    const byStageMap = new Map<string, { label: string; sla_hours: number; overdue: number }>();
    const byUserMap = new Map<string, number>();
    let activeOverdue = 0;

    for (const s of withSla) {
      const sinceIso = new Date(Date.now() - s._hours * 3_600_000).toISOString();
      let q = context.supabase
        .from("posts")
        .select("id, assignee_id")
        .eq("brand_id", data.brandId)
        .eq("stage_id", s.id)
        .is("deleted_at", null)
        .lt("stage_entered_at", sinceIso);
      if (clientIds.length > 0) q = q.in("client_id", clientIds);
      if (assigneeIds.length > 0) q = q.in("assignee_id", assigneeIds);
      if (projectIds.length > 0) q = q.in("project_id", projectIds);
      if (channels.length > 0) q = q.overlaps("channels", channels as never);
      if (tags.length > 0) q = q.overlaps("tags", tags);
      const { data: rows, error } = await q;
      if (error) throw error;
      const count = (rows ?? []).length;
      if (count === 0) continue;
      activeOverdue += count;
      byStageMap.set(s.id, {
        label: s.label,
        sla_hours: s._hours,
        overdue: count,
      });
      for (const r of rows ?? []) {
        const uid = (r.assignee_id as string | null) ?? "__unassigned__";
        byUserMap.set(uid, (byUserMap.get(uid) ?? 0) + 1);
      }
    }

    const userIds = Array.from(byUserMap.keys()).filter((u) => u !== "__unassigned__");
    const profMap = new Map<string, { full_name: string; avatar_url: string | null }>();
    if (userIds.length > 0) {
      const { data: profs } = await context.supabase
        .from("user_profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);
      for (const p of profs ?? []) {
        profMap.set(p.id as string, {
          full_name: (p.full_name as string) || "Sem nome",
          avatar_url: (p.avatar_url as string | null) ?? null,
        });
      }
    }

    const byUser = Array.from(byUserMap.entries())
      .map(([user_id, overdue]) => {
        const p = profMap.get(user_id);
        return {
          user_id,
          full_name:
            user_id === "__unassigned__" ? "Sem responsável" : (p?.full_name ?? "Sem nome"),
          avatar_url: p?.avatar_url ?? null,
          overdue,
        };
      })
      .sort((a, b) => b.overdue - a.overdue);

    const byStage = Array.from(byStageMap.entries())
      .map(([stage_id, v]) => ({ stage_id, ...v }))
      .sort((a, b) => b.overdue - a.overdue);

    return { activeOverdue, byUser, byStage };
  });

// ---------- Pipelines ----------
const clientScope = z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() });

export const listPipelinesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => clientScope.parse(i))
  .handler(async ({ data, context }): Promise<Pipeline[]> => {
    const { data: pipes, error } = await context.supabase
      .from("content_pipelines")
      .select("id,brand_id,client_id,name,slug,is_default,position")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;

    if (!pipes || pipes.length === 0) return [];

    const { data: counts } = await context.supabase
      .from("posts")
      .select("pipeline_id")
      .in(
        "pipeline_id",
        pipes.map((p) => p.id),
      );
    const countMap = new Map<string, number>();
    (counts ?? []).forEach((r: { pipeline_id: string | null }) => {
      if (!r.pipeline_id) return;
      countMap.set(r.pipeline_id, (countMap.get(r.pipeline_id) ?? 0) + 1);
    });
    return pipes.map((p) => ({ ...p, post_count: countMap.get(p.id) ?? 0 }));
  });

export const ensureDefaultPipelineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => clientScope.parse(i))
  .handler(async ({ data, context }): Promise<Pipeline> => {
    const { data: existing } = await context.supabase
      .from("content_pipelines")
      .select("id,brand_id,client_id,name,slug,is_default,position")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1);
    if (existing && existing.length > 0) return { ...existing[0], post_count: 0 };

    const { data: pipe, error } = await context.supabase
      .from("content_pipelines")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        name: "Pipeline principal",
        slug: "main",
        is_default: true,
        position: 0,
        created_by: context.userId,
      })
      .select("id,brand_id,client_id,name,slug,is_default,position")
      .single();
    if (error) throw error;

    await context.supabase.from("content_pipeline_stages").insert(
      DEFAULT_STAGES.map((s, i) => ({
        pipeline_id: pipe.id,
        key: s.key,
        label: s.label,
        color: s.color,
        position: i * 1024,
        is_terminal: s.is_terminal ?? false,
      })),
    );

    return { ...pipe, post_count: 0 };
  });

export const createPipelineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        name: z.string().min(1).max(80),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<Pipeline> => {
    const slug =
      data.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || `pipeline-${Date.now()}`;

    const { data: maxRow } = await context.supabase
      .from("content_pipelines")
      .select("position")
      .eq("client_id", data.clientId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = ((maxRow?.[0]?.position ?? -1) as number) + 1;

    const { data: pipe, error } = await context.supabase
      .from("content_pipelines")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        name: data.name.trim(),
        slug,
        is_default: false,
        position: nextPos,
        created_by: context.userId,
      })
      .select("id,brand_id,client_id,name,slug,is_default,position")
      .single();
    if (error) throw error;

    await context.supabase.from("content_pipeline_stages").insert(
      DEFAULT_STAGES.map((s, i) => ({
        pipeline_id: pipe.id,
        key: s.key,
        label: s.label,
        color: s.color,
        position: i * 1024,
        is_terminal: s.is_terminal ?? false,
      })),
    );
    return { ...pipe, post_count: 0 };
  });

export const renamePipelineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ pipelineId: z.string().uuid(), name: z.string().min(1).max(80) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("content_pipelines")
      .update({ name: data.name.trim() })
      .eq("id", data.pipelineId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Board ----------

export const loadBoardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        pipelineId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<Board> => {
    const [
      { data: pipe, error: pErr },
      { data: stages, error: sErr },
      { data: posts, error: poErr },
    ] = await Promise.all([
      context.supabase
        .from("content_pipelines")
        .select("id,brand_id,client_id,name,slug,is_default,position")
        .eq("id", data.pipelineId)
        .single(),
      context.supabase
        .from("content_pipeline_stages")
        .select(
          "id,pipeline_id,key,label,color,position,is_terminal,hide_in_portal,enables_approval_link,sla_days,sla_hours",
        )
        .eq("pipeline_id", data.pipelineId)
        .order("position", { ascending: true }),
      context.supabase
        .from("posts")
        .select(
          "id,title,copy,channels,scheduled_at,published_at,assignee_id,cover_url,stage_id,pipeline_id,position,created_at,updated_at,brand_id,client_id,review_status,ai_phase,rework_notes,priority,format,tags,visible_in_portal,project_id,remind_at,assignees,reference_media,stage_entered_at,target_connection_ids,monthly_plan_topic_id,proposed_at,schedule_status,schedule_approved_at,schedule_client_comment",
        )
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("pipeline_id", data.pipelineId)
        .is("deleted_at", null)
        .order("position", { ascending: true }),
    ]);
    if (pErr) throw pErr;
    if (sErr) throw sErr;
    if (poErr) throw poErr;

    // Fetch placements for this pipeline's posts so cards can render a chip
    // per format (Feed/Reels/Story/Carrossel) even when posts.format is null.
    const postIds = (posts ?? []).map((p) => p.id);
    if (postIds.length > 0) {
      const { data: placements } = await context.supabase
        .from("post_placements")
        .select("post_id,format,is_primary")
        .in("post_id", postIds);
      const byPost = new Map<string, Array<{ format: string; is_primary: boolean | null }>>();
      for (const pl of placements ?? []) {
        const arr = byPost.get(pl.post_id as string) ?? [];
        arr.push({
          format: pl.format as string,
          is_primary: (pl.is_primary as boolean | null) ?? false,
        });
        byPost.set(pl.post_id as string, arr);
      }
      for (const p of posts ?? []) {
        const list = byPost.get(p.id) ?? [];
        list.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
        (p as unknown as { placements: typeof list }).placements = list;
      }
    }

    // Auto-assign posts com stage_id nulo (herança do backfill divergente)
    const orphaned = (posts ?? []).filter((p) => !p.stage_id);
    if (orphaned.length > 0 && stages && stages.length > 0) {
      const firstStage = stages[0].id;
      await context.supabase
        .from("posts")
        .update({ stage_id: firstStage })
        .in(
          "id",
          orphaned.map((p) => p.id),
        );
      orphaned.forEach((p) => (p.stage_id = firstStage));
    }

    // Derive cover_url from first image in reference_media when missing.
    // Uses signed URLs so private brand media renders in the card. Suporta
    // tanto o bucket unificado `brand-media` quanto legado `brand-assets`.
    const needsCover = (posts ?? []).filter((p) => {
      if (p.cover_url) return false;
      const refs = Array.isArray(p.reference_media)
        ? (p.reference_media as Array<Record<string, unknown>>)
        : [];
      return refs.some((r) => {
        const type = typeof r?.type === "string" ? (r.type as string) : "";
        const path = typeof r?.path === "string" ? (r.path as string) : "";
        return path && (type.startsWith("image/") || !type);
      });
    });
    if (needsCover.length > 0) {
      // Agrupa por bucket e usa `createSignedUrls` (batch) para eliminar N+1
      // de chamadas ao Storage — antes: 1 request por post.
      const byBucket = new Map<string, { path: string; post: (typeof needsCover)[number] }[]>();
      for (const p of needsCover) {
        const refs = (p.reference_media as Array<Record<string, unknown>>) ?? [];
        const firstImg = refs.find((r) => {
          const type = typeof r?.type === "string" ? (r.type as string) : "";
          const path = typeof r?.path === "string" ? (r.path as string) : "";
          return path && (type.startsWith("image/") || !type);
        });
        const thumbPath =
          typeof firstImg?.thumb_path === "string" ? (firstImg.thumb_path as string) : null;
        const originalPath = typeof firstImg?.path === "string" ? (firstImg.path as string) : null;
        const target = thumbPath ?? originalPath;
        if (!target) continue;
        const bucket =
          typeof firstImg?.bucket === "string" ? (firstImg.bucket as string) : "brand-media";
        const list = byBucket.get(bucket) ?? [];
        list.push({ path: target, post: p });
        byBucket.set(bucket, list);
      }
      await Promise.all(
        Array.from(byBucket.entries()).map(async ([bucket, entries]) => {
          const paths = entries.map((e) => e.path);
          const { data: signedList } = await context.supabase.storage
            .from(bucket)
            .createSignedUrls(paths, 60 * 60 * 24 * 7);
          if (!signedList) return;
          signedList.forEach((signed, idx) => {
            const url = signed?.signedUrl;
            if (url) entries[idx].post.cover_url = url;
          });
        }),
      );
    }

    return {
      pipeline: { ...pipe, post_count: (posts ?? []).length },
      stages: (stages ?? []) as PipelineStage[],
      posts: annotateOverdue((posts ?? []) as BoardPost[], (stages ?? []) as PipelineStage[]),
    };
  });

// ---------- Post move (optimistic) ----------

export const movePostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        toStageId: z.string().uuid(),
        toPosition: z.number().int(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: before } = await context.supabase
      .from("posts")
      .select("brand_id, stage_id, title")
      .eq("id", data.postId)
      .maybeSingle();

    // `posts.stage_id` é a fonte operacional do estágio; `posts.stage` é o
    // campo legado (consumido pela tela de Projeto, relatórios e pelo trigger
    // `notify_post_approval_events`). Sempre que stage_id muda, espelhamos o
    // valor legado usando o helper canônico (mesma regra da trigger no banco).
    // NÃO REMOVER sem antes migrar os consumidores legados.
    const legacyStage = await resolveLegacyStage(context.supabase, data.toStageId);
    const updatePatch: Record<string, unknown> = {
      stage_id: data.toStageId,
      position: data.toPosition,
    };
    if (legacyStage) updatePatch.stage = legacyStage;

    const { error } = await context.supabase
      .from("posts")
      .update(updatePatch as never)
      .eq("id", data.postId);
    if (error) throw error;
    if (before?.brand_id && before.stage_id !== data.toStageId) {
      ingestBrainQuiet(
        context.supabase,
        before.brand_id as string,
        "content_stage_changed",
        "editorial",
        {
          title: before.title,
          from_stage_id: before.stage_id,
          to_stage_id: data.toStageId,
        },
      );
    }
    return { ok: true };
  });

/**
 * Move vários posts de estágio de uma vez (Conteúdo → modo seleção).
 *
 * Mesma semântica do `movePostFn` individual: espelha o estágio legado
 * (`posts.stage`) e registra evento Brain best-effort. RLS continua sendo a
 * barreira de escopo — o update é filtrado por brand/client/pipeline e pelos
 * IDs recebidos, e retorna resultado por item para a UI.
 */
export const bulkMoveStageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        pipelineId: z.string().uuid(),
        postIds: z.array(z.string().uuid()).min(1).max(200),
        toStageId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Estágio precisa pertencer ao mesmo pipeline (evita mover para outro board).
    const { data: stage, error: stErr } = await context.supabase
      .from("content_pipeline_stages")
      .select("id,pipeline_id,label")
      .eq("id", data.toStageId)
      .eq("pipeline_id", data.pipelineId)
      .maybeSingle();
    if (stErr) throw stErr;
    if (!stage) throw new Error("Estágio inválido para este fluxo de conteúdo.");

    const ids = Array.from(new Set(data.postIds));
    const { data: rows, error: rowsErr } = await context.supabase
      .from("posts")
      .select("id,title,stage_id,position")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .eq("pipeline_id", data.pipelineId)
      .is("deleted_at", null)
      .in("id", ids);
    if (rowsErr) throw rowsErr;

    const allowed = new Map((rows ?? []).map((r) => [r.id as string, r]));
    const legacyStage = await resolveLegacyStage(context.supabase, data.toStageId);

    // Posição: entra ao final do estágio de destino, preservando a ordem atual.
    const { data: last } = await context.supabase
      .from("posts")
      .select("position")
      .eq("stage_id", data.toStageId)
      .is("deleted_at", null)
      .order("position", { ascending: false })
      .limit(1);
    let nextPos = ((last?.[0]?.position ?? 0) as number) + 1024;

    const results: Array<{ postId: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      const row = allowed.get(id);
      if (!row) {
        results.push({ postId: id, ok: false, error: "Fora do escopo atual" });
        continue;
      }
      if (row.stage_id === data.toStageId) {
        results.push({ postId: id, ok: true });
        continue;
      }
      const patch: Record<string, unknown> = { stage_id: data.toStageId, position: nextPos };
      if (legacyStage) patch.stage = legacyStage;
      const { error } = await context.supabase
        .from("posts")
        .update(patch as never)
        .eq("id", id);
      if (error) {
        results.push({ postId: id, ok: false, error: error.message });
        continue;
      }
      nextPos += 1024;
      results.push({ postId: id, ok: true });
      ingestBrainQuiet(context.supabase, data.brandId, "content_stage_changed", "editorial", {
        title: row.title,
        from_stage_id: row.stage_id,
        to_stage_id: data.toStageId,
        bulk: true,
      });
    }

    return {
      ok: true,
      moved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  });


// ---------- Stages CRUD ----------

export const createStageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        pipelineId: z.string().uuid(),
        label: z.string().min(1).max(40),
        color: z.enum(STAGE_COLORS).default("muted"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const key = `stage-${Date.now().toString(36)}`;
    const { data: maxRow } = await context.supabase
      .from("content_pipeline_stages")
      .select("position")
      .eq("pipeline_id", data.pipelineId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = ((maxRow?.[0]?.position ?? -1) as number) + 1024;

    const { data: st, error } = await context.supabase
      .from("content_pipeline_stages")
      .insert({
        pipeline_id: data.pipelineId,
        key,
        label: data.label.trim(),
        color: data.color,
        position: nextPos,
      })
      .select(
        "id,pipeline_id,key,label,color,position,is_terminal,hide_in_portal,enables_approval_link",
      )
      .single();
    if (error) throw error;
    return st as PipelineStage;
  });

export const updateStageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        stageId: z.string().uuid(),
        patch: z
          .object({
            label: z.string().min(1).max(40).optional(),
            color: z.enum(STAGE_COLORS).optional(),
            is_terminal: z.boolean().optional(),
            hide_in_portal: z.boolean().optional(),
            enables_approval_link: z.boolean().optional(),
            sla_days: z.number().int().min(0).max(365).nullable().optional(),
            sla_hours: z
              .number()
              .int()
              .min(0)
              .max(24 * 365)
              .nullable()
              .optional(),
            position: z.number().int().optional(),
          })
          .strict(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("content_pipeline_stages")
      .update(data.patch)
      .eq("id", data.stageId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteStageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ stageId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Move posts to first remaining stage of same pipeline
    const { data: stage } = await context.supabase
      .from("content_pipeline_stages")
      .select("id,pipeline_id")
      .eq("id", data.stageId)
      .maybeSingle();
    if (!stage) return { ok: true };
    const { data: siblings } = await context.supabase
      .from("content_pipeline_stages")
      .select("id")
      .eq("pipeline_id", stage.pipeline_id)
      .neq("id", data.stageId)
      .order("position", { ascending: true })
      .limit(1);
    if (!siblings || siblings.length === 0) {
      throw new Error("Não é possível excluir a única coluna do pipeline.");
    }
    await context.supabase
      .from("posts")
      .update({ stage_id: siblings[0].id })
      .eq("stage_id", data.stageId);
    const { error } = await context.supabase
      .from("content_pipeline_stages")
      .delete()
      .eq("id", data.stageId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Post CRUD + detail ----------

export const createPostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        pipelineId: z.string().uuid(),
        stageId: z.string().uuid(),
        title: z.string().min(1).max(160),
        copy: z.string().max(6000).nullable().optional(),
        channels: z.array(z.string().max(40)).max(12).optional(),
        target_connection_ids: z.array(z.string().uuid()).max(20).optional(),
        format: z.string().max(60).nullable().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
        tags: z.array(z.string().max(40)).max(20).optional(),
        scheduled_at: z.string().nullable().optional(),
        remind_at: z.string().nullable().optional(),
        internal_briefing: z.string().max(8000).nullable().optional(),
        client_briefing: z.string().max(8000).nullable().optional(),
        script: z.array(z.any()).nullable().optional(),
        assignees: z.array(z.string().uuid()).max(20).optional(),
        project_id: z.string().uuid().nullable().optional(),
        visible_in_portal: z.boolean().optional(),
        recurrence: z.any().nullable().optional(),
        destinations: z.array(DestinationSchema).max(12).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<BoardPost> => {
    // Limite de produção na criação manual (quando a regra do cliente pede).
    const { checkManualScope } = await import("@/lib/scope-manual.server");
    const scope = await checkManualScope(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
    });
    if (scope.blocked) {
      throw new Error(
        `scope_limit_reached: limite de produção do mês atingido (${scope.used}/${scope.quota}). Solicite liberação em Produção.`,
      );
    }

    const { data: maxRow } = await context.supabase

      .from("posts")
      .select("position")
      .eq("stage_id", data.stageId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = ((maxRow?.[0]?.position ?? -1) as number) + 1024;

    // stage legado derivado da coluna do pipeline (fonte operacional)
    const legacyStage =
      (await resolveLegacyStage(context.supabase, data.stageId, "idea")) ?? "idea";

    const insertRow: Record<string, unknown> = {
      brand_id: data.brandId,
      client_id: data.clientId,
      pipeline_id: data.pipelineId,
      stage_id: data.stageId,
      title: data.title.trim(),
      stage: legacyStage,
      position: nextPos,
      created_by: context.userId,
    };

    const optional: Array<keyof typeof data> = [
      "copy",
      "channels",
      "target_connection_ids",
      "format",
      "priority",
      "tags",
      "scheduled_at",
      "remind_at",
      "internal_briefing",
      "client_briefing",
      "script",
      "assignees",
      "project_id",
      "visible_in_portal",
      "recurrence",
    ];
    for (const k of optional) {
      if (data[k] !== undefined) insertRow[k as string] = data[k];
    }
    // Fronteira de escrita: `posts.format` só aceita chave canônica.
    if (data.format !== undefined) {
      insertRow.format = data.format ? normalizeContentFormat(data.format) : null;
    }

    // Quando o cliente envia `destinations` estruturados, eles se tornam a
    // fonte de verdade — `channels`/`target_connection_ids` viram cache.
    if (data.destinations && data.destinations.length) {
      insertRow.channels = deriveChannelsFromDestinations(data.destinations);
      insertRow.target_connection_ids = deriveTargetConnectionIds(data.destinations);
    }

    // Fallback: se nenhum responsável foi fornecido, atribui ao usuário que
    // criou o conteúdo (operador atual). Como último recurso, ao owner da marca.
    const hasAssignees = Array.isArray(data.assignees) && data.assignees.length > 0;
    if (hasAssignees) {
      insertRow.assignee_id = data.assignees![0];
    } else {
      let fallback: string = context.userId;
      // Se por algum motivo o userId não existir, cai para o owner.
      if (!fallback) {
        const { data: ownerRow } = await context.supabase
          .from("brand_members")
          .select("user_id")
          .eq("brand_id", data.brandId)
          .eq("role", "owner")
          .limit(1)
          .maybeSingle();
        fallback = (ownerRow?.user_id as string | undefined) ?? context.userId;
      }
      insertRow.assignee_id = fallback;
      insertRow.assignees = [fallback];
    }

    const { data: post, error } = await context.supabase
      .from("posts")
      .insert(insertRow as never)
      .select(
        "id,title,copy,channels,scheduled_at,published_at,assignee_id,cover_url,stage_id,pipeline_id,position,created_at,updated_at,brand_id,client_id,target_connection_ids",
      )
      .single();
    if (error) throw error;

    if (data.destinations && data.destinations.length) {
      await syncPostPlacements(context.supabase, {
        postId: post.id as string,
        brandId: data.brandId,
        clientId: data.clientId,
        destinations: data.destinations as PlacementDestination[],
        scheduledIso: (post.scheduled_at as string | null) ?? null,
        status: "draft",
      });
    }

    ingestBrainQuiet(context.supabase, data.brandId, "content_created", "editorial", {
      title: data.title,
      channels: data.channels,
      format: data.format,
      client_id: data.clientId,
    });
    return post as BoardPost;
  });

export const updatePostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        patch: z
          .object({
            title: z.string().min(1).max(160).optional(),
            copy: z.string().max(6000).nullable().optional(),
            scheduled_at: z.string().nullable().optional(),
            assignee_id: z.string().uuid().nullable().optional(),
            channels: z
              .array(z.enum(["instagram", "tiktok", "linkedin", "x", "youtube", "blog"]))
              .optional(),
            target_connection_ids: z.array(z.string().uuid()).max(20).optional(),
            reference_media: z
              .array(
                z.object({
                  path: z.string(),
                  name: z.string().optional(),
                  type: z.string().optional(),
                  size: z.number().optional(),
                }),
              )
              .optional(),
            design_brief: z.string().max(8000).nullable().optional(),
            review_status: z.enum(["pending", "approved", "rejected", "rework"]).optional(),
            priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
            format: z.string().max(60).nullable().optional(),
            tags: z.array(z.string().max(40)).max(20).optional(),
            visible_in_portal: z.boolean().optional(),
            internal_briefing: z.string().max(8000).nullable().optional(),
            client_briefing: z.string().max(8000).nullable().optional(),
            script: z.array(z.any()).nullable().optional(),
            references: z.array(z.any()).nullable().optional(),
            remind_at: z.string().nullable().optional(),
            stage_id: z.string().uuid().nullable().optional(),
            project_id: z.string().uuid().nullable().optional(),
          })
          .strict(),
        destinations: z.array(DestinationSchema).max(12).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { ...data.patch };
    // Fronteira de escrita: `posts.format` só aceita chave canônica.
    if (patch.format !== undefined) {
      patch.format = patch.format ? normalizeContentFormat(patch.format) : null;
    }
    // stage_id é a fonte operacional: ao mudar de coluna, espelhamos o campo
    // legado `posts.stage` pelo helper canônico.
    if (typeof patch.stage_id === "string") {
      const legacy = await resolveLegacyStage(context.supabase, patch.stage_id as string);
      if (legacy) patch.stage = legacy;
    }
    if (patch.review_status === "approved") {
      patch.approved_at = new Date().toISOString();
      patch.approved_by = context.userId;
      // Regra de negócio: aprovação força o estágio legado "approved" (o
      // trigger `notify_post_approval_events` depende dele).
      patch.stage = "approved";
    }

    // Destinos estruturados sobrescrevem channels/target_connection_ids
    // (post_placements é a fonte de verdade).
    if (data.destinations !== undefined) {
      patch.channels = deriveChannelsFromDestinations(data.destinations);
      patch.target_connection_ids = deriveTargetConnectionIds(data.destinations);
    }

    // Regra dos 5 minutos: só vale para peça JÁ agendada (fila ativa). Mudar a
    // data de uma peça em produção/ideia é planejamento editorial, não fila.
    if (typeof patch.scheduled_at === "string") {
      const { data: cur } = await context.supabase
        .from("posts")
        .select("stage")
        .eq("id", data.postId)
        .maybeSingle();
      if ((cur?.stage as string | null) === "scheduled") {
        assertScheduleLead(patch.scheduled_at as string);
      }
    }

    const { error } = await context.supabase

      .from("posts")
      .update(patch as never)
      .eq("id", data.postId);
    if (error) throw error;

    // Mudança de data na peça precisa refletir nos placements ainda não
    // publicados — o calendário lê `post_placements.scheduled_at`.
    if (data.destinations === undefined && patch.scheduled_at !== undefined) {
      await context.supabase
        .from("post_placements")
        .update({ scheduled_at: patch.scheduled_at as string | null } as never)
        .eq("post_id", data.postId)
        .neq("status", "published");

      // Reagendamento de peça JÁ enfileirada precisa mover a fila real
      // (`social_posts`), senão o worker publicaria no horário antigo.
      if (typeof patch.scheduled_at === "string") {
        await context.supabase
          .from("social_posts")
          .update({ scheduled_at: patch.scheduled_at })
          .eq("post_id", data.postId)
          .eq("status", "scheduled");
      }
    }

    if (data.destinations !== undefined) {
      const { data: row, error: rErr } = await context.supabase
        .from("posts")
        .select("brand_id, client_id, scheduled_at")
        .eq("id", data.postId)
        .single();
      if (rErr) throw rErr;
      await syncPostPlacements(context.supabase, {
        postId: data.postId,
        brandId: row.brand_id as string,
        clientId: row.client_id as string,
        destinations: data.destinations as PlacementDestination[],
        scheduledIso: (row.scheduled_at as string | null) ?? null,
        status: "draft",
      });
    }
    return { ok: true };
  });

export const deletePostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("posts")
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq("id", data.postId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Completar/refazer a geração da peça pelos agentes ----------
// Usa o mesmo orquestrador da materialização da pauta (agent_prompts).
export const regeneratePostContentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ postId: z.string().uuid(), force: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // Autorização: o usuário precisa alcançar a peça via RLS.
    const { data: post, error } = await context.supabase
      .from("posts")
      .select("id")
      .eq("id", data.postId)
      .maybeSingle();
    if (error) throw error;
    if (!post) throw new Error("Peça não encontrada");

    const { generatePostContent } = await import("@/lib/post-agents.server");
    const res = await generatePostContent(data.postId, {
      force: data.force ?? true,
      userId: context.userId,
    });
    if (res.status === "failed") {
      if (res.kind === "provider_quota") {
        throw new Error(
          "A geração não foi concluída porque a cota da API de IA da marca foi atingida. A peça ficou pendente e pode ser retomada mais tarde.",
        );
      }
      if (res.kind === "provider_rate_limit" || res.kind === "provider_unavailable") {
        throw new Error(
          "O provedor de IA está temporariamente indisponível. A peça ficou pendente e pode ser retomada em instantes.",
        );
      }
      throw new Error(`A geração falhou no agente ${res.agent}: ${res.error}`);
    }
    return res;
  });

// ---------- Rework: reset status, move card back to review stage ----------

export const reworkPostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        notes: z.string().max(2000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: post, error: pe } = await context.supabase
      .from("posts")
      .select("id, pipeline_id, stage_id, brand_id, client_id, title, copy")
      .eq("id", data.postId)
      .maybeSingle();
    if (pe) throw pe;
    if (!post) throw new Error("post_not_found");

    // Find a "review"-ish stage (fallback to first stage of same pipeline)
    let targetStageId: string | null = null;
    if (post.pipeline_id) {
      const { data: stages } = await context.supabase
        .from("content_pipeline_stages")
        .select("id, key, label, position")
        .eq("pipeline_id", post.pipeline_id)
        .order("position", { ascending: true });
      const list = stages ?? [];
      const review = list.find(
        (s) => s.key?.toLowerCase() === "review" || /revis|reason|rewrit/i.test(s.label ?? ""),
      );
      targetStageId = review?.id ?? list[0]?.id ?? post.stage_id ?? null;
    }

    const patch: Record<string, unknown> = {
      review_status: "rework",
      approved_at: null,
      approved_by: null,
      ai_phase: "idea",
      rework_notes: data.notes ?? null,
    };
    if (targetStageId && targetStageId !== post.stage_id) {
      patch.stage_id = targetStageId;
      const legacy = await resolveLegacyStage(context.supabase, targetStageId);
      if (legacy) patch.stage = legacy;
    }

    const { error } = await context.supabase
      .from("posts")
      .update(patch as never)
      .eq("id", data.postId);
    if (error) throw error;

    // Brain: close the learning loop — register rework feedback + enqueue learning.
    try {
      const brainCtx = {
        supabase: context.supabase,
        userId: context.userId,
        brandId: (post as { brand_id?: string | null }).brand_id ?? null,
        clientId: (post as { client_id?: string | null }).client_id ?? null,
        module: "content",
      };
      const feedbackPayload = {
        post_id: data.postId,
        brand_id: (post as { brand_id?: string | null }).brand_id ?? null,
        client_id: (post as { client_id?: string | null }).client_id ?? null,
        original_title: (post as { title?: string | null }).title ?? null,
        original_copy: (post as { copy?: string | null }).copy ?? null,
        user_notes: data.notes ?? null,
      };
      await brain.registerEvent(brainCtx, {
        source_module: "content",
        event_type: "post.rework",
        payload: feedbackPayload,
      });
    } catch (err) {
      console.warn("[content.rework] brain feedback failed:", err);
    }

    return { ok: true };
  });

export type PostTimelineEvent = {
  id: string;
  verb: string;
  payload: string | null;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
};

export const getPostDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ postId: z.string().uuid() }).parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      post: BoardPost;
      timeline: PostTimelineEvent[];
      destinations: Array<{
        connectionId: string;
        channel: string;
        format: "feed" | "stories" | "reels" | "carrossel";
      }>;
      project: { id: string; name: string; color: string | null } | null;
    }> => {
      const [{ data: post, error }, { data: events }, { data: placements }] = await Promise.all([
        context.supabase
          .from("posts")
          .select(
            "id,title,copy,channels,scheduled_at,published_at,remind_at,assignee_id,cover_url,stage_id,pipeline_id,position,created_at,updated_at,brand_id,client_id,review_status,reference_media,design_brief,ai_phase,approved_at,approved_by,rework_notes,priority,format,tags,visible_in_portal,internal_briefing,client_briefing,script,references,target_connection_ids,project_id,monthly_plan_topic_id,proposed_at,schedule_status,schedule_approved_at,schedule_client_comment,projects:project_id(id,name,color)",
          )
          .eq("id", data.postId)
          .single(),
        context.supabase
          .from("activity_events")
          .select("id,verb,payload,created_at,actor_id")
          .eq("entity_type", "post")
          .eq("entity_id", data.postId)
          .order("created_at", { ascending: false })
          .limit(30),
        context.supabase
          .from("post_placements")
          .select("format,copy_override,is_primary")
          .eq("post_id", data.postId)
          .order("is_primary", { ascending: false }),
      ]);
      if (error) throw error;
      const destinations = (placements ?? [])
        .map((pl) => {
          const co = (pl.copy_override ?? {}) as Record<string, unknown>;
          const connectionId = typeof co.connection_id === "string" ? co.connection_id : "";
          const channel = typeof co.channel === "string" ? co.channel : "";
          if (!connectionId || !channel) return null;
          return {
            connectionId,
            channel,
            format: pl.format as "feed" | "stories" | "reels" | "carrossel",
          };
        })
        .filter(Boolean) as Array<{
        connectionId: string;
        channel: string;
        format: "feed" | "stories" | "reels" | "carrossel";
      }>;
      const actorIds = Array.from(
        new Set((events ?? []).map((e) => e.actor_id).filter(Boolean) as string[]),
      );
      const actorMap = new Map<string, { name: string | null; avatar: string | null }>();
      if (actorIds.length > 0) {
        const { data: profs } = await context.supabase
          .from("user_profiles")
          .select("id, full_name, avatar_url")
          .in("id", actorIds);
        (profs ?? []).forEach((p) =>
          actorMap.set(p.id as string, {
            name: (p.full_name as string) ?? null,
            avatar: (p.avatar_url as string | null) ?? null,
          }),
        );
      }
      // Herança real do projeto: peça materializada de uma pauta que já possui
      // projeto deve apontar para o MESMO projects.id. Corrige vínculo ausente
      // sem criar projeto novo e sem inventar dados.
      const rawPost = post as unknown as {
        project_id: string | null;
        monthly_plan_topic_id: string | null;
        projects?: { id: string; name: string; color: string | null } | null;
      };
      let project = rawPost.projects ?? null;
      let projectId = rawPost.project_id ?? null;
      if (!projectId && rawPost.monthly_plan_topic_id) {
        const { data: topic } = await context.supabase
          .from("monthly_plan_topics")
          .select("monthly_plan_id")
          .eq("id", rawPost.monthly_plan_topic_id)
          .maybeSingle();
        const planId =
          (topic as unknown as { monthly_plan_id: string | null } | null)?.monthly_plan_id ?? null;
        if (planId) {
          const { data: plan } = await context.supabase
            .from("monthly_plans")
            .select("project_id, projects:project_id(id,name,color)")
            .eq("id", planId)
            .maybeSingle();
          const planRow = plan as unknown as {
            project_id: string | null;
            projects?: { id: string; name: string; color: string | null } | null;
          } | null;
          if (planRow?.project_id) {
            projectId = planRow.project_id;
            project = planRow.projects ?? null;
            await context.supabase
              .from("posts")
              .update({ project_id: projectId } as never)
              .eq("id", data.postId)
              .is("project_id", null);
          }
        }
      }

      return {
        post: { ...(post as BoardPost), project_id: projectId },
        project,
        timeline: (events ?? []).map((e) => ({
          id: e.id,
          verb: e.verb,
          payload: e.payload == null ? null : JSON.stringify(e.payload),
          created_at: e.created_at,
          actor_id: e.actor_id,
          actor_name: e.actor_id ? (actorMap.get(e.actor_id)?.name ?? null) : null,
          actor_avatar: e.actor_id ? (actorMap.get(e.actor_id)?.avatar ?? null) : null,
        })) as PostTimelineEvent[],
        destinations,
      };
    },
  );

// ---------- Reference media (Phase-2 uploads) ----------

export const uploadPostReferenceMediaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        filename: z.string().min(1).max(200),
        contentType: z.string().max(120),
        base64: z.string().min(1),
        variant: z.enum(["original", "thumb"]).optional().default("original"),
        originalPath: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: post, error: pe } = await context.supabase
      .from("posts")
      .select("id, brand_id, client_id, reference_media")
      .eq("id", data.postId)
      .single();
    if (pe || !post) throw pe ?? new Error("Post not found");

    const bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const isVideo = data.contentType.startsWith("video/");
    const maxBytes = isVideo ? 100 * 1024 * 1024 : 25 * 1024 * 1024;
    if (bin.byteLength > maxBytes) throw new Error("file_too_large");
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const subdir = data.variant === "thumb" ? "thumbs/" : "";
    // Unificado com o pipeline de publicação: sempre gravar em `brand-media`
    // para que qualquer mídia de referência do Kanban possa ser reaproveitada
    // diretamente pelo agendador/publicador via storagePath.
    const path = `${post.brand_id}/${post.client_id}/posts/${post.id}/${subdir}${Date.now()}-${safeName}`;
    const { error: ue } = await context.supabase.storage
      .from("brand-media")
      .upload(path, bin, { contentType: data.contentType, upsert: false });
    if (ue) throw ue;

    const current = Array.isArray(post.reference_media)
      ? (post.reference_media as Array<Record<string, unknown>>)
      : [];
    type MediaEntry = {
      path: string;
      name?: string;
      type?: string;
      size?: number;
      thumb_path?: string;
      originalPath?: string;
    };
    let next: Array<Record<string, unknown>>;
    let entry: MediaEntry;
    if (data.variant === "thumb" && data.originalPath) {
      // Attach thumb to existing entry identified by originalPath
      next = current.map((r) =>
        r?.path === data.originalPath ? { ...r, thumb_path: path, bucket: "brand-media" } : r,
      );
      entry = {
        path,
        thumb_path: path,
        originalPath: data.originalPath,
        bucket: "brand-media",
      } as MediaEntry & { bucket: string };
    } else {
      entry = {
        path,
        name: data.filename,
        type: data.contentType,
        size: bin.byteLength,
        bucket: "brand-media",
      } as MediaEntry & { bucket: string };
      next = [...current, entry];
    }
    const { error: upErr } = await context.supabase
      .from("posts")
      .update({ reference_media: next } as never)
      .eq("id", data.postId);
    if (upErr) throw upErr;

    const { data: signed } = await context.supabase.storage
      .from("brand-media")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    return { path, url: signed?.signedUrl ?? null, entry };
  });

export const removePostReferenceMediaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ postId: z.string().uuid(), path: z.string().min(1) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: post, error: pe } = await context.supabase
      .from("posts")
      .select("id, reference_media")
      .eq("id", data.postId)
      .single();
    if (pe || !post) throw pe ?? new Error("Post not found");

    const current = Array.isArray(post.reference_media)
      ? (post.reference_media as Array<Record<string, unknown>>)
      : [];
    const entry = current.find((r) => r?.path === data.path);
    const bucket =
      (typeof entry?.bucket === "string" ? (entry.bucket as string) : null) ?? "brand-media";
    await context.supabase.storage.from(bucket).remove([data.path]);
    const next = current.filter((r) => r?.path !== data.path);
    const { error } = await context.supabase
      .from("posts")
      .update({ reference_media: next } as never)
      .eq("id", data.postId);
    if (error) throw error;
    return { ok: true };
  });

export const signPostReferenceMediaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ paths: z.array(z.string()).max(20) }).parse(i))
  .handler(async ({ data, context }) => {
    if (data.paths.length === 0) return { urls: {} as Record<string, string> };
    // Buckets legados (brand-assets) e novo bucket unificado (brand-media)
    // coexistem — tentamos primeiro brand-media e recorremos ao legado para
    // os paths que ainda não migraram.
    const urls: Record<string, string> = {};
    const remaining = new Set(data.paths);
    const { data: signedNew } = await context.supabase.storage
      .from("brand-media")
      .createSignedUrls(data.paths, 60 * 60);
    (signedNew ?? []).forEach((s) => {
      if (s.path && s.signedUrl && !s.error) {
        urls[s.path] = s.signedUrl;
        remaining.delete(s.path);
      }
    });
    if (remaining.size > 0) {
      const { data: signedLegacy } = await context.supabase.storage
        .from("brand-assets")
        .createSignedUrls(Array.from(remaining), 60 * 60);
      (signedLegacy ?? []).forEach((s) => {
        if (s.path && s.signedUrl && !s.error) urls[s.path] = s.signedUrl;
      });
    }
    return { urls };
  });

// ---------- Stage reorder + replicate ----------

export const reorderStagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        pipelineId: z.string().uuid(),
        order: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    let pos = 1024;
    for (const id of data.order) {
      const { error } = await context.supabase
        .from("content_pipeline_stages")
        .update({ position: pos })
        .eq("id", id)
        .eq("pipeline_id", data.pipelineId);
      if (error) throw error;
      pos += 1024;
    }
    return { ok: true };
  });

// ---------- AI Reference Image Generation ----------

export const generatePostReferenceImageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        extraPrompt: z.string().max(500).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: post, error } = await context.supabase
      .from("posts")
      .select("id, brand_id, client_id, title, copy, format, reference_media")
      .eq("id", data.postId)
      .single();
    if (error || !post) throw error ?? new Error("post_not_found");

    // Parse copy sections (### GANCHO / HEADLINE / COPY / CTA)
    const raw = (post.copy as string | null) ?? "";
    const pick = (label: string) => {
      const re = new RegExp(`###\\s+${label}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, "i");
      const m = raw.match(re);
      return m?.[1]?.trim() ?? "";
    };
    const hook = pick("GANCHO");
    const headline = pick("HEADLINE");
    const body = pick("COPY");

    const prompt = [
      `Gere uma imagem de referência visual (moodboard) para um post de rede social.`,
      `Formato: ${post.format ?? "feed"}. Título: ${post.title}.`,
      hook ? `Hook: ${hook}` : "",
      headline ? `Headline: ${headline}` : "",
      body ? `Mensagem: ${body.slice(0, 400)}` : "",
      data.extraPrompt ? `Direção adicional: ${data.extraPrompt}` : "",
      `Estilo: fotográfico/editorial, iluminação premium, composição limpa, pronto para social media.`,
    ]
      .filter(Boolean)
      .join("\n");

    const { generateBrandImage } = await import("./ai-provider.server");
    const { base64: b64, contentType } = await generateBrandImage(
      context.supabase,
      post.brand_id,
      prompt,
    );
    const ext = contentType.split("/")[1] ?? "png";
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    const filename = `ai-${Date.now()}.${ext}`;
    const path = `${post.brand_id}/${post.client_id}/posts/${post.id}/${filename}`;
    const { error: ue } = await context.supabase.storage
      .from("brand-media")
      .upload(path, bin, { contentType, upsert: false });
    if (ue) throw ue;

    const entry = {
      path,
      name: filename,
      type: contentType,
      size: bin.byteLength,
      source: "ai" as const,
      bucket: "brand-media" as const,
    };
    const current = Array.isArray(post.reference_media)
      ? (post.reference_media as Array<Record<string, unknown>>)
      : [];
    const next = [...current, entry];
    const { error: upErr } = await context.supabase
      .from("posts")
      .update({ reference_media: next } as never)
      .eq("id", data.postId);
    if (upErr) throw upErr;

    // Log activity event — escopo herdado do post (já validado pela RLS na
    // leitura acima). `activity_events` não tem policy de INSERT para
    // `authenticated`: a escrita usa o client privilegiado, sempre com
    // brand_id/client_id derivados da entidade de origem.
    {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: evErr } = await supabaseAdmin.from("activity_events").insert({
        brand_id: post.brand_id,
        client_id: post.client_id ?? null,
        entity_type: "post",
        entity_id: data.postId,
        verb: "media_generated",
        actor_id: context.userId,
        payload: { filename } as never,
      } as never);
      // Auditoria não deve derrubar a geração de mídia, mas o erro é visível.
      if (evErr) console.error("activity_events insert failed (media_generated)", evErr);
    }

    return { ok: true, path };
  });

// ---------- Fila de retomada: peças pendentes voltam ao pipeline oficial ----------
export const resumePendingPostsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        limit: z.number().min(1).max(20).optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { resumePendingPostContent } = await import("@/lib/post-agents.server");
    return resumePendingPostContent({ ...data, userId: context.userId });
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeClientHealthScore } from "@/lib/client-health";
import { normalizePortalTheme, portalThemeSchema } from "@/lib/portal-theme";
import { assertClientInBrand } from "@/lib/access-guard";
import { resolveInclusiveRange } from "@/lib/date-range";
import { computeBriefingCompletion } from "@/lib/briefing-progress";
import { buildBriefingAlert } from "@/lib/briefing-alert";
import type { BrandHubData } from "@/lib/brand-hub.functions";

const scope = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  range: z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    })
    .optional(),
});

export type CustomerDashboardData = Awaited<ReturnType<typeof loadCustomerDashboardFn>>;

export const loadCustomerDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scope.parse(i))
  .handler(async ({ data, context }) => {
    // Fase 4: o par (brandId, clientId) vem do contexto ativo do frontend.
    // Rejeita pares cross-workspace (cliente de A com workspace B) e clientes
    // fora do escopo — nunca devolve um painel vazio "silencioso".
    await assertClientInBrand(context.supabase, context.userId, data.brandId, data.clientId);
    const nowMs = Date.now();
    // Contagem inclusiva compartilhada com o filtro de datas.
    const {
      fromIso,
      toIso,
      fromMs: safeFrom,
      toMs,
      days: rangeDays,
    } = resolveInclusiveRange(data.range, { defaultDays: 30, maxDays: 90 });
    const midCut = Math.max(safeFrom, toMs - Math.floor(rangeDays / 2) * 86_400_000);
    const midCutIso = new Date(midCut).toISOString();

    const [
      client,
      portalTokens,
      activity,
      pipelinesRes,
      tasks,
      usage,
      aiJobsCountRes,
      briefingRes,
    ] = await Promise.all([
      context.supabase
        .from("clients")
        .select(
          "id,name,niche,color,socials,contact_name,contact_email,tone_of_voice,is_active,created_at,updated_at,brand_hub,briefing_status",
        )
        .eq("id", data.clientId)
        .maybeSingle(),
      context.supabase
        .from("portal_tokens")
        .select("id,token,label,expires_at,revoked_at,last_seen_at,created_at")
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("activity_events")
        .select("id,entity_type,entity_id,verb,payload,created_at,actor_id")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: false })
        .limit(25),
      context.supabase
        .from("content_pipelines")
        .select("id,name,slug,is_default,position,created_at")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .order("is_default", { ascending: false })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      context.supabase
        .from("tasks")
        .select("id,status,done,done_at,due_at")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId),
      context.supabase
        .from("brand_ai_usage")
        .select("cost_usd,created_at")
        .eq("brand_id", data.brandId)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("ai_jobs")
        .select("id,kind,created_at")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
      context.supabase
        .from("client_briefings")
        .select("updated_at")
        .eq("client_id", data.clientId)
        .maybeSingle(),
    ]);

    // Cérebro da marca is persisted in clients.brand_hub (jsonb). Treat a
    // non-empty brand_hub as an effective briefing and derive the updated_at
    // from the clients row; fall back to the legacy client_briefings table.
    const brandHub =
      ((client.data as { brand_hub?: Record<string, unknown> } | null)?.brand_hub as
        | Record<string, unknown>
        | null
        | undefined) ?? null;
    const brandHubFilled =
      !!brandHub && typeof brandHub === "object" && Object.keys(brandHub).length > 0;
    const briefingUpdatedAt: string | null = brandHubFilled
      ? ((client.data as { updated_at?: string } | null)?.updated_at ?? null)
      : ((briefingRes?.data?.updated_at as string | null) ?? null);

    // Estado real de conclusão do briefing (fonte: clients.briefing_status +
    // completude canônica do brand_hub). Usado apenas para os alertas.
    const briefingStatus =
      ((client.data as { briefing_status?: string } | null)?.briefing_status as string | null) ??
      "draft";
    const briefingCompletion = computeBriefingCompletion(
      (brandHub ?? {}) as BrandHubData,
      { tone_of_voice: (client.data as { tone_of_voice?: string | null } | null)?.tone_of_voice ?? null },
    );

    const defaultPipeline = (pipelinesRes.data ?? [])[0] ?? null;

    const [stagesRes, posts] = await Promise.all([
      defaultPipeline
        ? context.supabase
            .from("content_pipeline_stages")
            .select("id,key,label,color,position")
            .eq("pipeline_id", defaultPipeline.id)
            .order("position", { ascending: true })
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              key: string;
              label: string;
              color: string | null;
              position: number;
            }>,
          }),
      context.supabase
        .from("posts")
        .select(
          "id,stage,stage_id,pipeline_id,scheduled_at,published_at,created_at,updated_at,deleted_at",
        )
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .is("deleted_at", null),
    ]);

    const stageRows = (stagesRes.data ?? []) as Array<{
      id: string;
      key: string;
      label: string;
      color: string | null;
      position: number;
    }>;
    // Only count posts in the default pipeline so the funnel matches the Kanban.
    const scopedPosts = (posts.data ?? []).filter(
      (p) => !defaultPipeline || p.pipeline_id === defaultPipeline.id,
    );

    const postIds = scopedPosts.map((p) => p.id as string);
    const { data: approvalData } = postIds.length
      ? await context.supabase
          .from("post_approvals")
          .select("id,status,post_id,created_at,updated_at")
          .in("post_id", postIds)
      : { data: [] as Array<{ status: string; created_at?: string; updated_at?: string }> };

    const stageById = new Map(stageRows.map((s) => [s.id, s]));
    const stageByKey = new Map(stageRows.map((s) => [s.key.toLowerCase(), s]));

    // Bucket AI cost per-day across the selected range for sparkline
    const sparkBuckets = Math.max(1, Math.min(rangeDays, 60));
    const days: string[] = Array.from({ length: sparkBuckets }, (_, i) => {
      const d = new Date(safeFrom + i * 86_400_000);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    });
    const bucket = new Map<string, number>(days.map((d) => [d, 0]));
    for (const row of usage.data ?? []) {
      const key = new Date(row.created_at as string).toISOString().slice(0, 10);
      if (bucket.has(key)) bucket.set(key, (bucket.get(key) ?? 0) + Number(row.cost_usd ?? 0));
    }
    const costSpark = Array.from(bucket.values());
    const costTotal30d = (usage.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const costTotal14d = (usage.data ?? [])
      .filter((r) => (r.created_at as string) >= midCutIso)
      .reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

    // Count posts per real Kanban stage (id first, fallback to legacy text key).
    const counts = new Map<string, number>(stageRows.map((s) => [s.id, 0]));
    for (const p of scopedPosts) {
      let target: string | null = null;
      if (p.stage_id && stageById.has(p.stage_id as string)) {
        target = p.stage_id as string;
      } else {
        const legacy = String(p.stage ?? "").toLowerCase();
        const match = stageByKey.get(legacy);
        if (match) target = match.id;
      }
      if (target) counts.set(target, (counts.get(target) ?? 0) + 1);
    }

    const pipelineStages = stageRows.map((s) => ({
      id: s.id,
      key: s.key,
      label: s.label,
      color: s.color,
      position: s.position,
      count: counts.get(s.id) ?? 0,
    }));
    const approvalRows = (approvalData ?? []) as Array<{
      status: string;
      created_at?: string;
      updated_at?: string;
    }>;
    const pendingApprovals = approvalRows.filter((a) => a.status === "pending").length;
    const decidedApprovals = approvalRows.length - pendingApprovals;

    const taskRows = (tasks.data ?? []) as Array<{ status: string }>;
    const openTasks = taskRows.filter((t) => t.status !== "done").length;
    const doneTasks = taskRows.length - openTasks;

    // Fonte única de verdade: social_posts vinculados aos cards do pipeline
    // default (via post_id). Isso mantém "Publicado" e "Agendado" alinhados
    // com o Kanban visível e independente do label da coluna.
    let publishedCount = 0;
    let scheduledCount = 0;
    if (postIds.length > 0) {
      const [pubRes, schedRes] = await Promise.all([
        context.supabase
          .from("social_posts")
          .select("id", { count: "exact", head: true })
          .in("post_id", postIds)
          .eq("status", "published")
          .gte("published_at", fromIso)
          .lte("published_at", toIso),
        context.supabase
          .from("social_posts")
          .select("id", { count: "exact", head: true })
          .in("post_id", postIds)
          .in("status", ["scheduled", "publishing"]),
      ]);
      publishedCount = pubRes.count ?? 0;
      scheduledCount = schedRes.count ?? 0;
    }

    const taskRowsFull = (tasks.data ?? []) as Array<{
      status: string;
      done: boolean | null;
      done_at: string | null;
      due_at: string | null;
    }>;
    const postsForHealth = (posts.data ?? []) as Array<{
      stage: string;
      scheduled_at: string | null;
      updated_at: string | null;
    }>;
    const health = computeClientHealthScore({
      tasks: taskRowsFull.map((t) => ({
        done: !!t.done,
        done_at: t.done_at,
        due_at: t.due_at,
      })),
      posts: postsForHealth,
      briefingUpdatedAt,
    });

    const aiJobRows = (aiJobsCountRes?.data ?? []) as Array<{
      id: string;
      kind: string | null;
      created_at: string;
    }>;
    const aiJobsCount = aiJobRows.length;

    // Breakdown per-agent (uses ai_jobs.kind as agent proxy since brand_ai_usage
    // does not carry client_id). Cost is pro-rated from the client's brand-level
    // 30d cost by share of jobs — same 30d window used by costTotal30d.
    const agentAgg = new Map<string, number>();
    for (const j of aiJobRows) {
      const k = (j.kind ?? "outros").toString();
      agentAgg.set(k, (agentAgg.get(k) ?? 0) + 1);
    }
    const aiUsageByAgent = Array.from(agentAgg.entries())
      .map(([agent, jobs]) => ({
        agent,
        jobs,
        cost: aiJobsCount > 0 ? (costTotal30d * jobs) / aiJobsCount : 0,
      }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 6);

    // Alerts scoped to this client.
    const now = Date.now();
    const alerts: Array<{
      severity: "critical" | "warning" | "info";
      title: string;
      description?: string;
      count?: number;
    }> = [];
    const briefingUpdated = briefingUpdatedAt;
    void briefingUpdated;
    const briefingAlert = buildBriefingAlert({
      status: briefingStatus,
      completion: briefingCompletion,
    });
    if (briefingAlert) alerts.push(briefingAlert);
    const stalePending = approvalRows.filter(
      (a) =>
        a.status === "pending" &&
        !!a.created_at &&
        now - new Date(a.created_at).getTime() > 2 * 86_400_000,
    ).length;
    if (stalePending > 0) {
      alerts.push({
        severity: "warning",
        title: "Aprovações paradas",
        description: "Pendentes há mais de 2 dias",
        count: stalePending,
      });
    }
    const overdueTasks = (tasks.data ?? []).filter(
      (t) =>
        (t as { status?: string; due_at?: string | null }).status !== "done" &&
        !!(t as { due_at?: string | null }).due_at &&
        new Date((t as { due_at: string }).due_at).getTime() < now,
    ).length;
    if (overdueTasks > 0) {
      alerts.push({
        severity: "warning",
        title: "Tarefas atrasadas",
        description: "Vencimento já passou",
        count: overdueTasks,
      });
    }
    if (scopedPosts.length === 0 && !!briefingUpdated) {
      alerts.push({
        severity: "info",
        title: "Pipeline vazio",
        description: "Briefing pronto — gere as primeiras pautas",
      });
    }

    return {
      client: client.data,
      portalTokens: portalTokens.data ?? [],
      activity: activity.data ?? [],
      pipeline: {
        pipelineId: defaultPipeline?.id ?? null,
        pipelineName: defaultPipeline?.name ?? null,
        stages: pipelineStages,
        total: scopedPosts.length,
      },
      alerts,
      aiUsageByAgent,
      metrics: {
        costTotal30d,
        costTotal14d,
        costSpark,
        pendingApprovals,
        decidedApprovals,
        totalApprovals: approvalRows.length,
        scheduled: scheduledCount,
        published: publishedCount,
        openTasks,
        doneTasks,
        aiJobsCount,
        health,
      },
    };
  });

function randomToken(len = 40): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

export const createPortalTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        label: z.string().trim().min(1).max(80).default("Public link"),
        expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const token = randomToken();
    const expires_at = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 3600 * 1000).toISOString()
      : null;
    const { data: row, error } = await context.supabase
      .from("portal_tokens")
      .insert({
        client_id: data.clientId,
        token,
        label: data.label,
        expires_at,
        created_by: context.userId,
      })
      .select("id,token,label,expires_at,revoked_at,last_seen_at,created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * Fase 0c — revogação de link do portal.
 * mode "revoke": apenas revoga (cliente fica sem link ativo).
 * mode "revokeAndCreate": revoga TODOS os links ativos do cliente e emite um
 * novo, mantendo a premissa de "um link ativo por cliente" da Fase 1.
 * O escopo é garantido por RLS (context.supabase) + checagem de brand do cliente.
 */
export const revokePortalTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        mode: z.enum(["revoke", "revokeAndCreate"]).default("revoke"),
        label: z.string().trim().min(1).max(80).default("Portal do cliente"),
        expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: client, error: cErr } = await context.supabase
      .from("clients")
      .select("id, brand_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client) throw new Error("forbidden");

    const nowIso = new Date().toISOString();
    const { data: revoked, error: rErr } = await context.supabase
      .from("portal_tokens")
      .update({ revoked_at: nowIso })
      .eq("client_id", data.clientId)
      .is("revoked_at", null)
      .select("id");
    if (rErr) throw new Error(rErr.message);
    const revokedCount = (revoked ?? []).length;

    if (data.mode === "revoke") {
      return { ok: true, revokedCount, token: null };
    }

    const expires_at = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 3600 * 1000).toISOString()
      : null;
    const { data: row, error: iErr } = await context.supabase
      .from("portal_tokens")
      .insert({
        client_id: data.clientId,
        token: randomToken(),
        label: data.label,
        expires_at,
        created_by: context.userId,
      })
      .select("id,token,label,expires_at,revoked_at,last_seen_at,created_at")
      .single();
    if (iErr) throw new Error(iErr.message);
    return { ok: true, revokedCount, token: row };
  });

/**
 * Fase 2 — leitura enxuta do link do portal para o card no perfil do cliente.
 * Retorna o link ativo (premissa: no máximo 1 por cliente, garantida por índice
 * único no banco) e a data da última revogação, para o badge "revogado".
 */
export const getPortalLinkFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("portal_tokens")
      .select("id,token,label,expires_at,revoked_at,last_seen_at,created_at")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const all = rows ?? [];
    const active = all.find((t) => !t.revoked_at) ?? null;
    const lastRevokedAt = all.find((t) => !!t.revoked_at)?.revoked_at ?? null;
    return { active, lastRevokedAt, total: all.length };
  });

/**
 * Fase 2 — personalização do link ativo (rótulo e expiração), sem rotacionar
 * o token. Escopo garantido por RLS via context.supabase + filtro por cliente.
 */
export const updatePortalTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        tokenId: z.string().uuid(),
        label: z.string().trim().min(1).max(80),
        // Ausente = manter a validade atual. null = remover expiração.
        expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const patch: { label: string; expires_at?: string | null } = { label: data.label };
    if (data.expiresInDays !== undefined) {
      patch.expires_at = data.expiresInDays
        ? new Date(Date.now() + data.expiresInDays * 24 * 3600 * 1000).toISOString()
        : null;
    }
    const { data: row, error } = await context.supabase
      .from("portal_tokens")
      .update(patch)
      .eq("id", data.tokenId)
      .eq("client_id", data.clientId)
      .is("revoked_at", null)
      .select("id,token,label,expires_at,revoked_at,last_seen_at,created_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("portal_link_not_found");
    return row;
  });

/* ------------------------- Fase 3 — tema do portal ------------------------- */

/**
 * Lê o tema do portal + os defaults de identidade do cliente (cor/logo do
 * cadastro), usados como sugestão quando o usuário liga "customizada".
 */
export const getPortalThemeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("clients")
      .select("id,brand_id,name,color,logo_url,portal_theme")
      .eq("id", data.clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("client_not_found");
    return {
      theme: normalizePortalTheme(row.portal_theme),
      defaults: { color: row.color ?? null, logoUrl: row.logo_url ?? null },
    };
  });

/** Salva o tema já validado (hex/URL) — jsonb que vai direto pro style público. */
export const updatePortalThemeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid(), theme: portalThemeSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const theme = portalThemeSchema.parse(data.theme);
    const { data: row, error } = await context.supabase
      .from("clients")
      .update({ portal_theme: theme as never })
      .eq("id", data.clientId)
      .select("id,portal_theme")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("client_not_found");
    return { theme: normalizePortalTheme(row.portal_theme) };
  });

/**
 * Upload da logo white-label do portal — reaproveita o bucket brand-assets já
 * usado no Briefing. Não escreve em clients.logo_url: o white-label pode
 * divergir da identidade interna.
 */
export const uploadPortalLogoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        filename: z.string().max(200),
        contentType: z.string().max(120),
        base64: z.string().min(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: client, error: ce } = await context.supabase
      .from("clients")
      .select("id,brand_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (ce) throw new Error(ce.message);
    if (!client) throw new Error("client_not_found");

    const bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bin.byteLength > 5 * 1024 * 1024) throw new Error("asset_too_large");
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${client.brand_id}/${client.id}/portal-logo-${Date.now()}-${safeName}`;
    const { error } = await context.supabase.storage
      .from("brand-assets")
      .upload(path, bin, { contentType: data.contentType, upsert: true });
    if (error) throw error;
    const { data: signed, error: se } = await context.supabase.storage
      .from("brand-assets")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (se) throw se;
    return { url: signed.signedUrl, path };
  });

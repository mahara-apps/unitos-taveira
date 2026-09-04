// Agregação read-only da central de acompanhamento de um cliente.
// Todos os números vêm de tabelas reais e são escopados por brand_id + client_id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveInclusiveRange } from "@/lib/date-range";
import {
  channelDisplayLabel,
  connectionDisplayName,
  connectionHandle,
} from "@/lib/channel-display-name";
import type {
  ClientActivityItem,
  ClientAttentionItem,
  ClientDashboard,
  ClientStageStat,
  ClientUpcomingItem,
} from "@/lib/client-dashboard.types";

type DB = SupabaseClient<any, "public", any>;

const DAY = 86_400_000;


const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  blog: "Blog",
};

export function channelLabel(raw: string): string {
  return CHANNEL_LABEL[raw.toLowerCase()] ?? raw;
}

export async function buildClientDashboard(
  supabase: DB,
  brandId: string,
  clientId: string,
  range?: { from?: string; to?: string },
): Promise<ClientDashboard> {
  const nowMs = Date.now();
  // Período resolvido pela fonte de verdade única: contagem INCLUSIVA idêntica
  // à do filtro (30 dias selecionados = 30 dias exibidos).
  const {
    fromIso,
    toIso,
    fromMs: safeFrom,
    toMs,
    days: rangeDays,
  } = resolveInclusiveRange(range, { defaultDays: 30 });
  const prevFromIso = new Date(safeFrom - rangeDays * DAY).toISOString();

  const [clientRes, pipelinesRes, postsRes, socialRes, connectionsRes, activityRes] =
    await Promise.all([
      supabase.from("clients").select("id,name,niche").eq("id", clientId).maybeSingle(),
      // Etapas vêm no MESMO round trip (select aninhado): antes havia um
      // segundo fetch serial só para ler as etapas do pipeline padrão.
      supabase
        .from("content_pipelines")
        .select(
          "id,is_default,position,created_at,content_pipeline_stages(id,key,label,position)",
        )
        .eq("brand_id", brandId)
        .eq("client_id", clientId)
        .order("is_default", { ascending: false })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("posts")
        .select(
          "id,title,stage,stage_id,pipeline_id,format,channels,scheduled_at,published_at,review_status,created_at,updated_at",
        )
        .eq("brand_id", brandId)
        .eq("client_id", clientId)
        .is("deleted_at", null),
      supabase
        .from("social_posts")
        .select("id,post_id,provider,connection_id,placement,status,last_error,scheduled_at,published_at")
        .eq("brand_id", brandId)
        .eq("client_id", clientId),
      supabase
        .from("client_social_accounts")
        .select(
          "connection_id, social_connections(id,channel,provider,channel_name,external_name,account_username,status,last_error)",
        )
        .eq("brand_id", brandId)
        .eq("client_id", clientId),
      supabase
        .from("activity_events")
        .select("id,entity_type,entity_id,verb,payload,created_at")
        .eq("brand_id", brandId)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

  const posts = (postsRes.data ?? []) as Array<Record<string, any>>;
  const socialPosts = (socialRes.data ?? []) as Array<Record<string, any>>;
  const defaultPipeline = (pipelinesRes.data ?? [])[0] ?? null;

  // ── Etapas reais do pipeline (já vieram no select aninhado) ─
  const stageRows = ((defaultPipeline?.content_pipeline_stages ?? []) as Array<{
    id: string;
    key: string;
    label: string;
    position: number;
  }>)
    .slice()
    .sort((a, b) => a.position - b.position);
  const stageById = new Map(stageRows.map((s) => [s.id, s]));
  const stageByKey = new Map(stageRows.map((s) => [s.key.toLowerCase(), s]));

  const scopedPosts = posts.filter(
    (p) => !defaultPipeline || !p.pipeline_id || p.pipeline_id === defaultPipeline.id,
  );

  const stageCounts = new Map<string, number>(stageRows.map((s) => [s.id, 0]));
  for (const p of scopedPosts) {
    let target: string | null = null;
    if (p.stage_id && stageById.has(p.stage_id)) target = p.stage_id;
    else {
      const match = stageByKey.get(String(p.stage ?? "").toLowerCase());
      if (match) target = match.id;
    }
    if (target) stageCounts.set(target, (stageCounts.get(target) ?? 0) + 1);
  }
  const pipelineTotal = Array.from(stageCounts.values()).reduce((s, v) => s + v, 0);
  const stages: ClientStageStat[] = stageRows.map((s) => {
    const count = stageCounts.get(s.id) ?? 0;
    return {
      id: s.id,
      key: s.key,
      label: s.label,
      count,
      share: pipelineTotal ? count / pipelineTotal : 0,
    };
  });

  // Gargalo: etapa não final que concentra mais de 40% do pipeline.
  const openStages = stages.filter((s) => !/publicad|published/i.test(s.key + s.label));
  const biggest = openStages.reduce<ClientStageStat | null>(
    (acc, s) => (!acc || s.count > acc.count ? s : acc),
    null,
  );
  const bottleneck =
    biggest && pipelineTotal >= 5 && biggest.share >= 0.4
      ? { label: biggest.label, count: biggest.count, share: biggest.share }
      : null;

  // ── Aprovações ────────────────────────────────────────────
  const postIds = scopedPosts.map((p) => p.id as string);
  const approvalsRes = postIds.length
    ? await supabase
        .from("post_approvals")
        .select("id,post_id,status,created_at,decided_at")
        .in("post_id", postIds)
    : { data: [] as Array<Record<string, any>> };
  const approvals = (approvalsRes.data ?? []) as Array<Record<string, any>>;
  const approvalsPending = approvals.filter((a) => a.status === "pending").length;
  const approvalsDecided = approvals.filter((a) => a.status !== "pending").length;

  // ── Publicações no período ────────────────────────────────
  const publishedPosts = scopedPosts.filter(
    (p) => p.published_at && p.published_at >= fromIso && p.published_at <= toIso,
  );
  const publishedInRange = publishedPosts.length;
  const prevPublished = scopedPosts.filter(
    (p) => p.published_at && p.published_at >= prevFromIso && p.published_at < fromIso,
  ).length;
  // Só comparamos quando existe base anterior real.
  const publishedPreviousRange = prevPublished > 0 ? prevPublished : null;

  const buckets = Math.min(rangeDays, 90);
  const dayKeys: string[] = Array.from({ length: buckets }, (_, i) => {
    const d = new Date(safeFrom + i * DAY);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  });
  const trendMap = new Map<string, number>(dayKeys.map((d) => [d, 0]));
  for (const p of publishedPosts) {
    const key = String(p.published_at).slice(0, 10);
    if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
  }
  // Série alinhada do período anterior (mesmo número de dias, deslocado).
  const prevKeys = Array.from({ length: buckets }, (_, i) => {
    const d = new Date(safeFrom - rangeDays * DAY + i * DAY);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  });
  const prevMap = new Map<string, number>(prevKeys.map((d) => [d, 0]));
  for (const p of scopedPosts) {
    if (!p.published_at) continue;
    const key = String(p.published_at).slice(0, 10);
    if (prevMap.has(key)) prevMap.set(key, (prevMap.get(key) ?? 0) + 1);
  }
  const publishTrend = dayKeys.map((day, i) => ({
    day,
    count: trendMap.get(day) ?? 0,
    previous: prevPublished > 0 ? (prevMap.get(prevKeys[i]!) ?? 0) : null,
  }));
  const avgPerWeek = publishedInRange > 0 ? publishedInRange / (rangeDays / 7) : null;
  const bestDay = publishTrend.reduce<{ day: string; count: number } | null>(
    (acc, d) =>
      d.count > 0 && (!acc || d.count > acc.count) ? { day: d.day, count: d.count } : acc,
    null,
  );

  // ── Canais (conexões realmente publicadas no período) ─────
  // Exibimos o NOME REAL cadastrado da conexão, nunca o provider técnico.
  const connectionRows = ((connectionsRes.data ?? []) as Array<Record<string, any>>)
    .map((row) => row.social_connections)
    .filter(Boolean) as Array<Record<string, any>>;
  const connById = new Map(connectionRows.map((c) => [String(c.id), c]));

  const channelMap = new Map<
    string,
    { channel: string; label: string; handle: string | null; count: number }
  >();
  const bumpChannel = (key: string, channel: string, label: string, handle: string | null = null) => {
    const prev = channelMap.get(key);
    if (prev) prev.count += 1;
    else channelMap.set(key, { channel, label, handle, count: 1 });
  };
  for (const sp of socialPosts) {
    if (sp.status !== "published" || !sp.published_at) continue;
    if (sp.published_at < fromIso || sp.published_at > toIso) continue;
    const conn = sp.connection_id ? connById.get(String(sp.connection_id)) : undefined;
    if (conn) {
      bumpChannel(
        `conn:${conn.id}`,
        String(conn.channel ?? conn.provider ?? "").toLowerCase(),
        connectionDisplayName(conn),
        connectionHandle(conn),
      );
      continue;
    }
    const key = String(sp.provider ?? "").toLowerCase();
    if (!key) continue;
    bumpChannel(`ch:${key}`, key, channelDisplayLabel(key));
  }
  if (channelMap.size === 0) {
    for (const p of publishedPosts) {
      for (const ch of (p.channels ?? []) as string[]) {
        const key = String(ch).toLowerCase();
        bumpChannel(`ch:${key}`, key, channelDisplayLabel(key));
      }
    }
  }
  const channelTotal = Array.from(channelMap.values()).reduce((s, v) => s + v.count, 0);
  const channelBreakdown = Array.from(channelMap.values())
    .map((c) => ({
      channel: c.channel,
      label: c.label,
      handle: c.handle,
      count: c.count,
      share: channelTotal ? c.count / channelTotal : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Falhas e conexões ─────────────────────────────────────
  const failedSocial = socialPosts.filter((sp) => ["failed", "blocked"].includes(sp.status));
  const scheduledSocial = socialPosts.filter((sp) => sp.status === "scheduled");
  const linkedConnections = connectionRows;
  const brokenConnections = linkedConnections.filter(
    (c) => c.status !== "active" || !!c.last_error,
  );

  const titleByPostId = new Map(scopedPosts.map((p) => [p.id as string, p.title as string]));

  const attention: ClientAttentionItem[] = [];
  for (const sp of failedSocial.slice(0, 5)) {
    attention.push({
      id: `social-${sp.id}`,
      severity: "critical",
      title: "Publicação falhou",
      description: `${channelLabel(String(sp.provider ?? ""))} · ${
        (sp.post_id && titleByPostId.get(sp.post_id)) || "Conteúdo sem título"
      }`,
      detail: sp.last_error ? String(sp.last_error).slice(0, 160) : null,
      action: { label: "Resolver", to: "/calendar" },
    });
  }
  if (approvalsPending > 0) {
    attention.push({
      id: "approvals",
      severity: "warning",
      title: "Aguardando aprovação",
      description:
        approvalsPending === 1
          ? "1 conteúdo está aguardando aprovação."
          : `${approvalsPending} conteúdos estão aguardando aprovação.`,
      detail: null,
      action: { label: "Ver aprovações", to: "/content" },
    });
  }
  for (const c of brokenConnections.slice(0, 4)) {
    attention.push({
      id: `conn-${c.id}`,
      severity: "warning",
      title: "Conexão precisa de atenção",
      description: `${channelLabel(String(c.channel ?? ""))}${
        c.account_username ? ` @${c.account_username}` : ""
      }`,
      detail: c.last_error ? String(c.last_error).slice(0, 160) : "Autorização necessária",
      action: { label: "Resolver conexão", to: "/connections" },
    });
  }

  // ── Conteúdo parado (sem movimentação) ────────────────────
  const STALL_DAYS = 7;
  const stallLimit = new Date(nowMs - STALL_DAYS * DAY).toISOString();
  const stalledPosts = scopedPosts.filter((p) => {
    if (p.published_at || p.scheduled_at) return false;
    const stageKey = String(
      (p.stage_id && stageById.get(p.stage_id)?.key) || p.stage || "",
    ).toLowerCase();
    if (/publicad|published|arquiv/.test(stageKey)) return false;
    return String(p.updated_at ?? p.created_at ?? "") < stallLimit;
  });
  const stalledStageCount = new Map<string, number>();
  for (const p of stalledPosts) {
    const label =
      (p.stage_id && stageById.get(p.stage_id)?.label) ||
      stageByKey.get(String(p.stage ?? "").toLowerCase())?.label ||
      null;
    if (label) stalledStageCount.set(label, (stalledStageCount.get(label) ?? 0) + 1);
  }
  const topStalledStage = Array.from(stalledStageCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const stalled = stalledPosts.length
    ? { count: stalledPosts.length, days: STALL_DAYS, stageLabel: topStalledStage }
    : null;
  if (stalled) {
    attention.push({
      id: "stalled",
      severity: "warning",
      title: "Conteúdo parado",
      description:
        stalled.count === 1
          ? `1 conteúdo sem movimentação há mais de ${STALL_DAYS} dias`
          : `${stalled.count} conteúdos sem movimentação há mais de ${STALL_DAYS} dias`,
      detail: stalled.stageLabel ? `Concentrado em ${stalled.stageLabel}` : null,
      action: { label: "Ver conteúdos", to: "/content" },
    });
  }

  // ── Próximas publicações (7 dias) ─────────────────────────
  const horizon = new Date(nowMs + 7 * DAY).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  const failedPostIds = new Set(failedSocial.map((sp) => sp.post_id).filter(Boolean));
  const pendingPostIds = new Set(
    approvals.filter((a) => a.status === "pending").map((a) => a.post_id),
  );
  const futureScheduled = scopedPosts.filter(
    (p) => p.scheduled_at && p.scheduled_at >= nowIso && !p.published_at,
  );
  const upcoming: ClientUpcomingItem[] = scopedPosts

    .filter((p) => p.scheduled_at && p.scheduled_at >= nowIso && p.scheduled_at <= horizon)
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
    .slice(0, 8)
    .map((p) => ({
      id: p.id as string,
      title: (p.title as string) || "Sem título",
      scheduledAt: p.scheduled_at as string,
      channels: ((p.channels ?? []) as string[]).map(channelLabel),
      format: (p.format as string | null) ?? null,
      status: p.published_at
        ? "published"
        : failedPostIds.has(p.id)
          ? "failed"
          : pendingPostIds.has(p.id)
            ? "awaiting_approval"
            : "scheduled",
    }));

  // ── Atividade recente em linguagem humana ─────────────────
  const activity = humanizeActivity(
    (activityRes.data ?? []) as Array<Record<string, any>>,
    titleByPostId,
  );

  return {
    generatedAt: new Date().toISOString(),
    rangeDays,
    client: (clientRes.data as ClientDashboard["client"]) ?? null,
    stages,
    pipelineTotal,
    bottleneck,
    approvalsPending,
    approvalsDecided,
    publishedInRange,
    publishedPreviousRange,
    publishTrend,
    avgPerWeek,
    bestDay,
    channelBreakdown,
    scheduledCount: scheduledSocial.length,
    upcomingTotal: futureScheduled.length,
    failedCount: failedSocial.length,
    connectionsNeedingAttention: brokenConnections.length,
    stalled,

    upcoming,
    attention,
    activity,
    // Não existe coleta de alcance/engajamento persistida hoje.
    hasPerformanceData: false,
  };
}

function humanizeActivity(
  rows: Array<Record<string, any>>,
  titleByPostId: Map<string, string>,
): ClientActivityItem[] {
  const out: ClientActivityItem[] = [];
  for (const row of rows) {
    const payload = (row.payload ?? {}) as Record<string, any>;
    const name =
      (typeof payload.title === "string" && payload.title) ||
      (row.entity_id ? titleByPostId.get(row.entity_id) : undefined) ||
      null;
    const item = describeEvent(String(row.entity_type), String(row.verb), payload, name);
    if (!item) continue;
    out.push({ id: row.id as string, at: row.created_at as string, ...item });
    if (out.length >= 12) break;
  }
  return out;
}

function describeEvent(
  entity: string,
  verb: string,
  payload: Record<string, any>,
  name: string | null,
): Omit<ClientActivityItem, "id" | "at"> | null {
  const label = name ?? (entity === "task" ? "Uma tarefa" : "Um conteúdo");
  const stageTo = typeof payload.to === "string" ? payload.to : null;

  if (entity === "post") {
    switch (verb) {
      case "created":
        return { title: label, description: "Novo conteúdo criado", tone: "neutral" };
      case "stage_changed":
        return {
          title: label,
          description: stageTo ? `Avançou para ${stageLabel(stageTo)}` : "Mudou de etapa",
          tone: "neutral",
        };
      case "ai_generated":
      case "ai_agent_succeeded":
        return { title: label, description: "Conteúdo gerado pela IA", tone: "positive" };
      case "ai_generation_failed":
        return { title: label, description: "Falha ao gerar conteúdo com IA", tone: "attention" };

      case "portal_approved":
        return { title: label, description: "Aprovado pelo cliente", tone: "positive" };
      case "portal_adjust":
        return { title: label, description: "Cliente pediu ajustes", tone: "attention" };
      case "portal_rejected":
        return { title: label, description: "Reprovado pelo cliente", tone: "attention" };
      case "published":
        return { title: label, description: "Publicado nas redes", tone: "positive" };
      default:
        return null;
    }
  }

  if (entity === "task") {
    if (verb === "created")
      return { title: label, description: "Nova tarefa de produção", tone: "neutral" };
    if (verb === "status_changed")
      return {
        title: label,
        description: stageTo ? `Tarefa movida para ${stageLabel(stageTo)}` : "Tarefa atualizada",
        tone: "neutral",
      };
    return null;
  }

  if (entity === "monthly_plan" && verb === "plan_step_ok")
    return { title: "Pauta do mês", description: "Pauta atualizada", tone: "neutral" };

  if (entity === "client_strategy" && verb === "ai_agent_succeeded")
    return { title: "Estratégia da conta", description: "Estratégia atualizada", tone: "positive" };

  if (entity === "client_strategy" && verb === "ai_generation_failed")
    return {
      title: "Estratégia da conta",
      description: "Falha ao gerar estratégia com IA",
      tone: "attention",
    };

  return null;
}

function stageLabel(raw: string): string {
  const map: Record<string, string> = {
    idea: "Ideias",
    production: "Produção",
    review: "Revisão",
    approved: "Aprovação",
    scheduled: "Agendado",
    published: "Publicado",
    todo: "A fazer",
    in_progress: "Em andamento",
    done: "Concluído",
  };
  return map[raw.toLowerCase()] ?? raw;
}

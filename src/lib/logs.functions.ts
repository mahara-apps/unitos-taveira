import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminAuthority } from "@/lib/access-guard";

export type LogLevel = "error" | "warn" | "info" | "success";
export type LogSource = "ai_job" | "activity" | "notification";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type SystemLogEntry = {
  id: string;
  source: LogSource;
  level: LogLevel;
  title: string;
  subtitle: string | null;
  timestamp: string;
  brand_id: string | null;
  client_id: string | null;
  actor_id: string | null;
  meta: JsonValue;
};

const Input = z.object({
  brandId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  sources: z.array(z.enum(["ai_job", "activity", "notification"])).optional(),
  levels: z.array(z.enum(["error", "warn", "info", "success"])).optional(),
  search: z.string().optional(),
  limit: z.number().min(10).max(500).optional(),
});

type JobRow = {
  id: string;
  brand_id: string;
  client_id: string | null;
  user_id: string | null;
  kind: string;
  title: string | null;
  subtitle: string | null;
  status: string;
  progress: number | null;
  step_label: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  input: unknown;
  result: unknown;
};

type ActivityRow = {
  id: string;
  brand_id: string;
  client_id: string | null;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  verb: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type NotificationRow = {
  id: string;
  brand_id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  payload: JsonValue | null;
  read_at: string | null;
  created_at: string;
};

function toJson(v: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(v ?? null)) as JsonValue;
  } catch {
    return null;
  }
}

function jobToEntry(j: JobRow): SystemLogEntry {
  const level: LogLevel =
    j.status === "failed"
      ? "error"
      : j.status === "succeeded"
        ? "success"
        : j.status === "running" || j.status === "queued"
          ? "info"
          : "warn";
  const subtitleParts = [
    j.kind,
    j.status,
    j.step_label ? `etapa: ${j.step_label}` : null,
    j.progress != null ? `${j.progress}%` : null,
  ].filter(Boolean) as string[];
  return {
    id: `job_${j.id}`,
    source: "ai_job",
    level,
    title: j.title ?? j.kind,
    subtitle: j.error ? j.error : (j.subtitle ?? subtitleParts.join(" · ")),
    timestamp: j.finished_at ?? j.started_at ?? j.updated_at ?? j.created_at,
    brand_id: j.brand_id,
    client_id: j.client_id,
    actor_id: j.user_id,
    meta: toJson({
      status: j.status,
      kind: j.kind,
      progress: j.progress,
      step_label: j.step_label,
      error: j.error,
      created_at: j.created_at,
      started_at: j.started_at,
      finished_at: j.finished_at,
      subtitle: j.subtitle,
      input: j.input,
      result: j.result,
    }),
  };
}

function activityToEntry(a: ActivityRow): SystemLogEntry {
  const payload = (a.payload ?? {}) as Record<string, unknown>;
  const title = typeof payload.title === "string" ? payload.title : `${a.entity_type} · ${a.verb}`;
  return {
    id: `act_${a.id}`,
    source: "activity",
    level: "info",
    title,
    subtitle: `${a.entity_type} · ${a.verb}`,
    timestamp: a.created_at,
    brand_id: a.brand_id,
    client_id: a.client_id,
    actor_id: a.actor_id,
    meta: toJson({
      entity_type: a.entity_type,
      entity_id: a.entity_id,
      verb: a.verb,
      payload,
    }),
  };
}

function notificationToEntry(n: NotificationRow): SystemLogEntry {
  const t = n.kind.toLowerCase();
  const level: LogLevel =
    t.includes("error") || t.includes("fail")
      ? "error"
      : t.includes("warn")
        ? "warn"
        : t.includes("success") || t.includes("done")
          ? "success"
          : "info";
  return {
    id: `not_${n.id}`,
    source: "notification",
    level,
    title: n.title,
    subtitle: n.body ?? n.kind,
    timestamp: n.created_at,
    brand_id: n.brand_id,
    client_id: null,
    actor_id: n.user_id,
    meta: toJson({
      kind: n.kind,
      href: n.href,
      payload: n.payload,
      read_at: n.read_at,
    }),
  };
}

export const listSystemLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<SystemLogEntry[]> => {
    const { supabase, userId } = context;
    // Auditoria exige papel administrativo DENTRO do workspace informado.
    // Sem workspace selecionado não há autoridade a avaliar (Fase 1 RBAC).
    if (!data.brandId) return [];
    await assertAdminAuthority(supabase, userId, data.brandId);
    const limit = data.limit ?? 200;
    const sources = data.sources ?? ["ai_job", "activity", "notification"];

    // Restrict to brands the user is a member of.
    const { data: memberships } = await supabase
      .from("brand_members")
      .select("brand_id")
      .eq("user_id", userId);
    const memberBrandIds = (memberships ?? []).map((m) => m.brand_id as string);
    if (memberBrandIds.length === 0) return [];

    const brandFilter = memberBrandIds.includes(data.brandId) ? [data.brandId] : [];
    if (brandFilter.length === 0) return [];


    const promises: Promise<SystemLogEntry[]>[] = [];

    if (sources.includes("ai_job")) {
      promises.push(
        (async () => {
          let q = supabase
            .from("ai_jobs")
            .select(
              "id, brand_id, client_id, user_id, kind, title, subtitle, status, progress, step_label, error, created_at, started_at, finished_at, updated_at, input, result",
            )
            .in("brand_id", brandFilter)
            .order("updated_at", { ascending: false })
            .limit(limit);
          if (data.clientId) q = q.eq("client_id", data.clientId);
          const { data: rows } = await q;
          return ((rows ?? []) as JobRow[]).map(jobToEntry);
        })(),
      );
    }

    if (sources.includes("activity")) {
      promises.push(
        (async () => {
          let q = supabase
            .from("activity_events")
            .select(
              "id, brand_id, client_id, actor_id, entity_type, entity_id, verb, payload, created_at",
            )
            .in("brand_id", brandFilter)
            .order("created_at", { ascending: false })
            .limit(limit);
          if (data.clientId) q = q.eq("client_id", data.clientId);
          const { data: rows } = await q;
          return ((rows ?? []) as ActivityRow[]).map(activityToEntry);
        })(),
      );
    }

    if (sources.includes("notification")) {
      promises.push(
        (async () => {
          const { data: rows } = await supabase
            .from("notifications")
            .select("id, brand_id, user_id, kind, title, body, href, payload, read_at, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(limit);
          return ((rows ?? []) as unknown as NotificationRow[]).map(notificationToEntry);
        })(),
      );
    }

    const chunks = await Promise.all(promises);
    let entries = chunks.flat();

    if (data.levels && data.levels.length > 0) {
      const set = new Set(data.levels);
      entries = entries.filter((e) => set.has(e.level));
    }

    if (data.search) {
      const s = data.search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.title.toLowerCase().includes(s) ||
          (e.subtitle ?? "").toLowerCase().includes(s) ||
          e.id.toLowerCase().includes(s),
      );
    }

    entries.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
    return entries.slice(0, limit);
  });

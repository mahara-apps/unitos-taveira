import { createHash } from "crypto";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizePortalTheme, resolvePortalTheme } from "@/lib/portal-theme";
import { fillPortalCovers, signPortalDocument, signPortalRefs } from "@/lib/portal-media.server";
import { assertPortalAccess } from "@/lib/portal-permissions.server";
import type { PortalModuleId } from "@/lib/portal-permissions";
import {
  hasServiceKey,
  resolveSessionScope,
  resolveTokenScope,
  scopedAdmin,
} from "@/lib/portal-scope.server";
import type {
  PortalApproval,
  PortalBriefing,
  PortalFile,
  PortalMetrics,
  PortalPost,
  PortalResolveResult,
  PortalSla,
} from "@/lib/portal-types";

type RpcError = { message: string } | null;
type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
};
export type SessionContext = { supabase: RpcClient };
type BasicMetrics = Omit<PortalMetrics, "sla">;

function publicClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("portal_configuration_unavailable");
  const opaque = key.startsWith("sb_");
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (opaque && headers.get("Authorization") === `Bearer ${key}`)
          headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

function clientIpHash(): string | null {
  const raw =
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-real-ip") ??
    (getRequestHeader("x-forwarded-for") ?? "").split(",")[0];
  const ip = raw.trim();
  if (!ip) return null;
  const salt = process.env["SUPABASE_PROJECT_ID"] ?? process.env["SUPABASE_URL"] ?? "portal";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

function isBusinessTokenError(message: string): boolean {
  return ["invalid_token", "token_revoked", "token_expired"].some((code) => message.includes(code));
}

async function publicRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const client = publicClient();
  const ipHash = args["_token"] ? clientIpHash() : null;
  if (ipHash) {
    const { data } = await client.rpc("portal_rate_status", { _ip_hash: ipHash });
    const status = data as { blocked?: boolean; retry_after?: number } | null;
    if (status?.blocked) throw new Error(`portal_rate_limited:${status.retry_after ?? 60}`);
  }
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    if (ipHash && isBusinessTokenError(error.message)) {
      await client.rpc("portal_rate_register_failure", { _ip_hash: ipHash });
    }
    throw new Error(error.message);
  }
  return data as T;
}

async function sessionRpc<T>(
  context: SessionContext,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await context.supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function slaFor(enteredAt: string | null, hours: number | null): PortalSla {
  if (!enteredAt || !hours || hours <= 0) {
    return {
      status: "none",
      slaHours: null,
      hoursInStage: 0,
      hoursRemaining: 0,
      hoursOverdue: 0,
      dueAt: null,
    };
  }
  const entered = new Date(enteredAt).getTime();
  const elapsed = Math.max(0, (Date.now() - entered) / 3_600_000);
  const progress = elapsed / hours;
  return {
    status: progress >= 1 ? "overdue" : progress >= 0.8 ? "at_risk" : "on_track",
    slaHours: hours,
    hoursInStage: elapsed,
    hoursRemaining: Math.max(0, hours - elapsed),
    hoursOverdue: Math.max(0, elapsed - hours),
    dueAt: new Date(entered + hours * 3_600_000).toISOString(),
  };
}

async function enrichSla(
  posts: PortalPost[],
  clientId: string,
  brandId: string,
): Promise<PortalPost[]> {
  const ids = posts.map((post) => post.id);
  if (!ids.length) return posts;
  // SLA é enriquecimento: sem chave de serviço o portal segue funcionando sem ele.
  if (!hasServiceKey()) return posts.map((post) => ({ ...post, sla: slaFor(null, null) }));
  const admin = await scopedAdmin();
  const { data: rows, error } = await admin
    .from("posts")
    .select("id, stage_id, stage_entered_at")
    .eq("client_id", clientId)
    .eq("brand_id", brandId)
    .eq("visible_in_portal", true)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const stageIds = Array.from(
    new Set((rows ?? []).map((row) => row.stage_id).filter(Boolean)),
  ) as string[];
  const stageHours = new Map<string, number>();
  if (stageIds.length) {
    const { data: stages, error: stageError } = await admin
      .from("content_pipeline_stages")
      .select("id, sla_hours, sla_days")
      .in("id", stageIds);
    if (stageError) throw new Error(stageError.message);
    for (const stage of stages ?? []) {
      const hours = stage.sla_hours ?? (stage.sla_days ? stage.sla_days * 24 : null);
      if (hours && hours > 0) stageHours.set(stage.id, hours);
    }
  }
  const slaById = new Map(
    (rows ?? []).map((row) => [
      row.id,
      slaFor(row.stage_entered_at, row.stage_id ? (stageHours.get(row.stage_id) ?? null) : null),
    ]),
  );
  return posts.map((post) => ({ ...post, sla: slaById.get(post.id) ?? slaFor(null, null) }));
}

async function slaSummary(clientId: string, brandId: string): Promise<PortalMetrics["sla"]> {
  if (!hasServiceKey()) return { tracked: 0, onTrack: 0, atRisk: 0, overdue: 0 };
  const admin = await scopedAdmin();
  const { data: rows, error } = await admin
    .from("posts")
    .select("id, stage_id, stage_entered_at")
    .eq("client_id", clientId)
    .eq("brand_id", brandId)
    .eq("visible_in_portal", true)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  const base = (rows ?? []).map((row) => ({
    id: row.id,
    title: null,
    format: null,
    channels: null,
    scheduled_at: null,
    stage: null,
    cover_url: null,
    reference_media: null,
  })) as PortalPost[];
  const enriched = await enrichSla(base, clientId, brandId);
  const tracked = enriched.filter((post) => post.sla?.status !== "none");
  return {
    tracked: tracked.length,
    onTrack: tracked.filter((post) => post.sla?.status === "on_track").length,
    atRisk: tracked.filter((post) => post.sla?.status === "at_risk").length,
    overdue: tracked.filter((post) => post.sla?.status === "overdue").length,
  };
}

function resolvedTheme(result: Omit<PortalResolveResult, "theme" | "error">): PortalResolveResult {
  return {
    ...result,
    theme: resolvePortalTheme(normalizePortalTheme(result.client?.portal_theme), {
      color: result.client?.color ?? null,
      logoUrl: result.client?.logo_url ?? null,
      agencyName: result.brand?.name ?? null,
    }),
  };
}

export async function resolveTokenPortal(token: string): Promise<PortalResolveResult> {
  try {
    const result = await publicRpc<Omit<PortalResolveResult, "theme" | "error">>("portal_resolve", {
      _token: token,
    });
    return resolvedTheme(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "portal_unavailable";
    if (!isBusinessTokenError(message)) throw error;
    return {
      clientId: null,
      brandId: null,
      client: null,
      brand: null,
      theme: null,
      error: message,
    };
  }
}

export async function resolveSessionPortal(
  context: SessionContext,
  clientId?: string,
): Promise<PortalResolveResult> {
  // Cliente obrigatório: sem ele o banco cairia no "último cliente visto".
  if (!clientId) throw new Error("portal_client_context_required");
  const result = await sessionRpc<Omit<PortalResolveResult, "theme" | "error">>(
    context,
    "portal_resolve",
    {
      _client_id: clientId,
    },
  );
  if (result.clientId && result.clientId !== clientId)
    throw new Error("portal_client_context_mismatch");
  return resolvedTheme(result);
}

async function tokenScope(token: string) {
  return resolveTokenScope(token);
}

async function sessionScope(
  context: SessionContext,
  clientId?: string,
  guard?: { module: PortalModuleId; need?: "view" | "interact" },
) {
  const scope = await resolveSessionScope(context.supabase, clientId);
  if (guard) {
    await assertPortalAccess(context.supabase, scope.clientId, guard.module, guard.need ?? "view");
  }
  return scope;
}

export async function tokenMetrics(token: string): Promise<PortalMetrics> {
  const [basic, scope] = await Promise.all([
    publicRpc<BasicMetrics>("portal_metrics", { _token: token }),
    tokenScope(token),
  ]);
  return { ...basic, sla: await slaSummary(scope.clientId, scope.brandId) };
}

export async function sessionMetrics(
  context: SessionContext,
  clientId?: string,
): Promise<PortalMetrics> {
  const scope = await sessionScope(context, clientId);
  const basic = await sessionRpc<BasicMetrics>(context, "portal_metrics", {
    _client_id: scope.clientId,
  });
  return { ...basic, sla: await slaSummary(scope.clientId, scope.brandId) };
}

export async function tokenApprovals(token: string, status: string): Promise<PortalPost[]> {
  const [rows, scope] = await Promise.all([
    publicRpc<PortalPost[]>("portal_approvals", { _token: token, _status: status }),
    tokenScope(token),
  ]);
  await fillPortalCovers(rows ?? []);
  return enrichSla(rows ?? [], scope.clientId, scope.brandId);
}

export async function sessionApprovals(
  context: SessionContext,
  clientId: string | undefined,
  status: string,
): Promise<PortalPost[]> {
  const scope = await sessionScope(context, clientId, { module: "approvals" });
  const rows = await sessionRpc<PortalPost[]>(context, "portal_approvals", {
    _client_id: scope.clientId,
    _status: status,
  });
  await fillPortalCovers(rows ?? []);
  return enrichSla(rows ?? [], scope.clientId, scope.brandId);
}

async function postResult(
  result: { post: PortalPost; approval: PortalApproval | null },
  clientId: string,
  brandId: string,
) {
  const posts = await enrichSla([result.post], clientId, brandId);
  const post = posts[0] ?? result.post;
  const media = await signPortalRefs(post.reference_media);
  if (!post.cover_url && media[0]) post.cover_url = media[0].url;
  return { post, approval: result.approval, media };
}

export async function tokenPost(token: string, postId: string) {
  const [result, scope] = await Promise.all([
    publicRpc<{ post: PortalPost; approval: PortalApproval | null }>("portal_post", {
      _token: token,
      _post_id: postId,
    }),
    tokenScope(token),
  ]);
  return postResult(result, scope.clientId, scope.brandId);
}

export async function sessionPost(
  context: SessionContext,
  clientId: string | undefined,
  postId: string,
) {
  const scope = await sessionScope(context, clientId, { module: "approvals" });
  const result = await sessionRpc<{ post: PortalPost; approval: PortalApproval | null }>(
    context,
    "portal_post",
    {
      _client_id: scope.clientId,
      _post_id: postId,
    },
  );
  return postResult(result, scope.clientId, scope.brandId);
}

export async function tokenDecide(): Promise<never> {
  // Link sem senha é somente leitura: decidir exige login do contato.
  throw new Error("portal_token_read_only");
}


export async function sessionDecide(
  context: SessionContext,
  clientId: string | undefined,
  postId: string,
  decision: string,
  note?: string,
) {
  const scope = await sessionScope(context, clientId, {
    module: "approvals",
    need: "interact",
  });
  return sessionRpc<{ ok: boolean }>(context, "portal_decide", {
    _client_id: scope.clientId,
    _post_id: postId,
    _decision: decision,
    _note: note ?? null,
  });
}

export async function tokenCalendar(token: string, month?: string): Promise<PortalPost[]> {
  const [rows, scope] = await Promise.all([
    publicRpc<PortalPost[]>("portal_calendar", { _token: token, _month: month ?? null }),
    tokenScope(token),
  ]);
  return enrichSla(rows ?? [], scope.clientId, scope.brandId);
}

export async function sessionCalendar(
  context: SessionContext,
  clientId: string | undefined,
  month?: string,
): Promise<PortalPost[]> {
  const scope = await sessionScope(context, clientId, { module: "calendar" });
  const rows = await sessionRpc<PortalPost[]>(context, "portal_calendar", {
    _client_id: scope.clientId,
    _month: month ?? null,
  });
  return enrichSla(rows ?? [], scope.clientId, scope.brandId);
}

export async function tokenFiles(token: string, search?: string) {
  const rows = await publicRpc<PortalFile[]>("portal_files", {
    _token: token,
    _search: search?.trim() || null,
  });
  return Promise.all(
    (rows ?? []).map(async (file) => ({
      ...file,
      url: await signPortalDocument(file.storage_path),
    })),
  );
}

export async function sessionFiles(
  context: SessionContext,
  clientId: string | undefined,
  search?: string,
) {
  const scope = await sessionScope(context, clientId, { module: "files" });
  const rows = await sessionRpc<PortalFile[]>(context, "portal_files", {
    _client_id: scope.clientId,
    _search: search?.trim() || null,
  });
  return Promise.all(
    (rows ?? []).map(async (file) => ({
      ...file,
      url: await signPortalDocument(file.storage_path),
    })),
  );
}

export function tokenBriefings(token: string) {
  return publicRpc<PortalBriefing[]>("portal_briefings", { _token: token });
}

export async function sessionBriefings(context: SessionContext, clientId?: string) {
  const scope = await sessionScope(context, clientId, { module: "briefing" });
  return sessionRpc<PortalBriefing[]>(context, "portal_briefings", { _client_id: scope.clientId });
}

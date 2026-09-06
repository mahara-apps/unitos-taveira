/**
 * Registro e leitura de acessos (login) ao sistema.
 *
 * Escrita: sempre server-side com service role, para que o cliente não possa
 * inserir/alterar registros (a tabela não tem GRANT de escrita para
 * `authenticated`). Leitura: Owner/Admin do workspace (ou Super Admin), com
 * RLS reforçada por `assertAdminAuthority`.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminAuthority } from "@/lib/access-guard";
import { displayName } from "@/lib/identity";
import {
  computeActivitySummary,
  ipPrefix,
  parseUserAgent,
  summarizeByPerson,
  type LoginActivitySummary,
  type LoginEventKind,
  type LoginEventRow,
  type LoginPersonSummary,
} from "@/lib/login-audit";

const PORTAL_ROLE = "portal_client";

type RequestMeta = {
  user_agent: string | null;
  device: string;
  os: string;
  browser: string;
  ip_prefix: string | null;
  city: string | null;
  country: string | null;
};

/** Metadados da requisição atual (nunca IP completo). */
function readRequestMeta(): RequestMeta {
  const ua = getRequestHeader("user-agent") ?? null;
  const { device, os, browser } = parseUserAgent(ua);
  const ip =
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-real-ip") ??
    getRequestHeader("x-forwarded-for") ??
    null;
  const city =
    getRequestHeader("x-vercel-ip-city") ?? getRequestHeader("cf-ipcity") ?? null;
  const country =
    getRequestHeader("x-vercel-ip-country") ?? getRequestHeader("cf-ipcountry") ?? null;
  return {
    user_agent: ua ? ua.slice(0, 400) : null,
    device,
    os,
    browser,
    ip_prefix: ipPrefix(ip),
    city: city ? decodeURIComponent(city).slice(0, 80) : null,
    country: country ? country.slice(0, 8) : null,
  };
}

/**
 * Registra um acesso bem-sucedido. Exige sessão válida: a identidade vem do
 * token, nunca do corpo da requisição.
 */
export const recordSignInFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ provider: z.string().max(40).optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    // Tipo de pessoa + escopo: contato do portal tem vínculo em client_members.
    const [{ data: portal }, { data: memberships }, { data: profile }] = await Promise.all([
      supabase
        .from("client_members")
        .select("client_id, clients(brand_id)")
        .eq("user_id", userId)
        .eq("role", PORTAL_ROLE)
        .limit(1),
      supabase
        .from("brand_members")
        .select("brand_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1),
      supabase.from("user_profiles").select("email").eq("id", userId).maybeSingle(),
    ]);

    const portalRow = (portal ?? [])[0] as
      | { client_id: string; clients: { brand_id: string } | null }
      | undefined;
    const kind: LoginEventKind = portalRow ? "portal_client" : "team";
    const brandId = portalRow?.clients?.brand_id ?? (memberships ?? [])[0]?.brand_id ?? null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_login_events").insert({
      user_id: userId,
      brand_id: brandId,
      client_id: portalRow?.client_id ?? null,
      kind,
      event: "sign_in",
      provider: data.provider ?? "password",
      email: (profile as { email?: string | null } | null)?.email ?? null,
      ...readRequestMeta(),
    });
    return { ok: true };
  });

/**
 * Registra uma tentativa que falhou. Recebe apenas o e-mail digitado; o
 * usuário/workspace é resolvido no servidor e a resposta é sempre a mesma
 * (não revela se a conta existe).
 */
export const recordFailedSignInFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().email().max(255) }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const email = data.email.toLowerCase();
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      const userId = (profile as { id?: string } | null)?.id ?? null;

      let brandId: string | null = null;
      let clientId: string | null = null;
      let kind: LoginEventKind = "team";
      if (userId) {
        const { data: portal } = await supabaseAdmin
          .from("client_members")
          .select("client_id, clients(brand_id)")
          .eq("user_id", userId)
          .eq("role", PORTAL_ROLE)
          .limit(1);
        const portalRow = (portal ?? [])[0] as
          | { client_id: string; clients: { brand_id: string } | null }
          | undefined;
        if (portalRow) {
          kind = "portal_client";
          clientId = portalRow.client_id;
          brandId = portalRow.clients?.brand_id ?? null;
        } else {
          const { data: memberships } = await supabaseAdmin
            .from("brand_members")
            .select("brand_id")
            .eq("user_id", userId)
            .limit(1);
          brandId = (memberships ?? [])[0]?.brand_id ?? null;
        }
      }

      await supabaseAdmin.from("user_login_events").insert({
        user_id: userId,
        brand_id: brandId,
        client_id: clientId,
        kind,
        event: "failed",
        provider: "password",
        email,
        ...readRequestMeta(),
      });
    } catch {
      /* auditoria nunca deve quebrar o fluxo de login */
    }
    return { ok: true };
  });

const ListInput = z.object({
  brandId: z.string().uuid(),
  days: z.number().int().min(1).max(365).optional(),
  kind: z.enum(["team", "portal_client"]).nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  onlyFailed: z.boolean().optional(),
  search: z.string().max(120).optional(),
  limit: z.number().int().min(50).max(2000).optional(),
});

export type LoginActivityResult = {
  events: LoginEventRow[];
  people: LoginPersonSummary[];
  summary: LoginActivitySummary;
};

export const listLoginActivityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<LoginActivityResult> => {
    const { supabase, userId } = context;
    // Owner/Admin do workspace (ou Super Admin). Manager não vê acessos.
    await assertAdminAuthority(supabase, userId, data.brandId);
    const role = await supabase.rpc("app_access_role", {
      _user_id: userId,
      _brand_id: data.brandId,
    });
    const roleName = String(role.data ?? "").toLowerCase();
    if (!["owner", "admin", "super_admin"].includes(roleName)) {
      throw new Error("Apenas Owner, Admin ou Super Admin podem ver o histórico de acessos.");
    }

    const days = data.days ?? 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const limit = data.limit ?? 1000;

    let q = supabase
      .from("user_login_events")
      .select(
        "id, user_id, brand_id, client_id, kind, event, provider, email, device, os, browser, city, country, created_at",
      )
      .eq("brand_id", data.brandId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.kind) q = q.eq("kind", data.kind);
    if (data.userId) q = q.eq("user_id", data.userId);
    if (data.onlyFailed) q = q.eq("event", "failed");

    const [{ data: rows, error }, teamRes, portalRes, clientsRes] = await Promise.all([
      q,
      supabase.from("brand_members").select("user_id").eq("brand_id", data.brandId),
      supabase
        .from("client_members")
        .select("user_id, client_id, clients!inner(id, name, brand_id)")
        .eq("role", PORTAL_ROLE)
        .eq("clients.brand_id", data.brandId),
      supabase.from("clients").select("id, name").eq("brand_id", data.brandId),
    ]);
    if (error) throw error;

    const clientNames = new Map<string, string>(
      ((clientsRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
    );

    const teamIds = ((teamRes.data ?? []) as { user_id: string }[]).map((m) => m.user_id);
    const portalRows = (portalRes.data ?? []) as { user_id: string; client_id: string }[];
    const allIds = [...new Set([...teamIds, ...portalRows.map((p) => p.user_id)])];

    const profiles = allIds.length
      ? ((
          await supabase.from("user_profiles").select("id, full_name, email").in("id", allIds)
        ).data ?? [])
      : [];
    const profileById = new Map(
      (profiles as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
        p.id,
        p,
      ]),
    );

    const portalByUser = new Map(portalRows.map((p) => [p.user_id, p.client_id]));

    const people = allIds.map((id) => {
      const p = profileById.get(id) ?? null;
      const clientId = portalByUser.get(id) ?? null;
      return {
        userId: id,
        name: displayName(p),
        email: p?.email ?? null,
        kind: (clientId ? "portal_client" : "team") as LoginEventKind,
        clientName: clientId ? (clientNames.get(clientId) ?? null) : null,
      };
    });

    const events: LoginEventRow[] = (
      (rows ?? []) as Omit<LoginEventRow, "person_name" | "person_email" | "client_name">[]
    ).map((r) => {
      const p = r.user_id ? profileById.get(r.user_id) : null;
      return {
        ...r,
        person_name: displayName(p ?? { email: r.email }),
        person_email: p?.email ?? r.email,
        client_name: r.client_id ? (clientNames.get(r.client_id) ?? null) : null,
      };
    });

    const filtered = data.search
      ? events.filter((e) => {
          const s = data.search!.toLowerCase();
          return (
            e.person_name.toLowerCase().includes(s) ||
            (e.person_email ?? "").toLowerCase().includes(s)
          );
        })
      : events;

    const visiblePeople = data.search
      ? people.filter(
          (p) =>
            p.name.toLowerCase().includes(data.search!.toLowerCase()) ||
            (p.email ?? "").toLowerCase().includes(data.search!.toLowerCase()),
        )
      : people;
    const scopedPeople = data.kind ? visiblePeople.filter((p) => p.kind === data.kind) : visiblePeople;

    return {
      events: filtered,
      people: summarizeByPerson(filtered, scopedPeople),
      summary: computeActivitySummary(filtered, scopedPeople.length),
    };
  });

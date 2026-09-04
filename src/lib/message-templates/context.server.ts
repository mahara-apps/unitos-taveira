/**
 * Resolver ÚNICO de contexto real dos eventos de comunicação (server-only).
 *
 * Regras:
 * - Sempre usa o client Supabase do chamador (RLS aplicada) ou service_role em
 *   worker: workspace A nunca alcança dados do workspace B.
 * - `clientId` é revalidado contra `clients.brand_id`: um cliente de outro
 *   workspace nunca entra na mensagem.
 * - Nada de dados de exemplo aqui. `buildSampleContext()` continua exclusivo do
 *   Preview/editor.
 * - `invite.password` só existe no contexto quando o próprio evento acabou de
 *   gerar a senha temporária (passada explicitamente). Nunca é persistida.
 */

import { tryInstallationAbsoluteUrl } from "@/lib/installation-url.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ContextSupabase = { from: (table: string) => any };

export type EventContextInput = {
  brandId: string;
  clientId?: string | null;
  userId?: string | null;
  /** Dados do usuário que o evento já conhece (ex.: convidado ainda sem perfil). */
  user?: { fullName?: string | null; email?: string | null; role?: string | null } | null;
  invite?: {
    token?: string | null;
    url?: string | null;
    role?: string | null;
    /** Senha temporária do próprio evento — nunca lida do banco nem logada. */
    password?: string | null;
  } | null;
  portal?: { token?: string | null; url?: string | null; expiresAt?: string | null } | null;
  post?: { title?: string | null; channel?: string | null; scheduledAt?: string | null } | null;
  task?: { title?: string | null; dueAt?: string | null } | null;
  report?: {
    period?: string | null;
    approvedCount?: number | null;
    publishedCount?: number | null;
    topPost?: string | null;
  } | null;
};

export class EventContextError extends Error {
  code = "contexto_do_evento_invalido" as const;
  constructor(message: string) {
    super(message);
    this.name = "EventContextError";
  }
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Admin",
  admin: "Admin",
  manager: "Manager",
  user: "Usuário",
  super_admin: "Super Admin",
  client: "Cliente",
};

export function roleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABELS[role] ?? role;
}

function formatDate(value: string | null | undefined, withTime = false): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(d);
  if (!withTime) return date;
  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
  return `${date} ${time}`;
}

function put(out: Record<string, string>, key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  const s = String(value).trim();
  if (!s) return;
  out[key] = s;
}

/**
 * Monta o contexto real do evento. Chaves ausentes simplesmente não entram no
 * mapa — o motor de renderização decide se isso é erro para o template em uso.
 */
export async function resolveEventContext(
  supabase: ContextSupabase,
  input: EventContextInput,
): Promise<Record<string, string>> {
  if (!input.brandId) throw new EventContextError("brandId obrigatório");
  const out: Record<string, string> = {};

  // ---- brand ----
  const brandRes = await supabase
    .from("brands")
    .select("id, name, nome_fantasia, logo_url")
    .eq("id", input.brandId)
    .maybeSingle();
  const brand = (brandRes?.data ?? null) as {
    name?: string | null;
    nome_fantasia?: string | null;
    logo_url?: string | null;
  } | null;
  if (!brand) throw new EventContextError("marca inacessível no escopo atual");
  put(out, "brand.name", brand.nome_fantasia || brand.name);
  put(out, "brand.logo", brand.logo_url);

  // ---- client (revalidado contra a marca) ----
  let clientId: string | null = null;
  if (input.clientId) {
    const clientRes = await supabase
      .from("clients")
      .select("id, brand_id, name, contact_name, contact_email")
      .eq("id", input.clientId)
      .maybeSingle();
    const client = (clientRes?.data ?? null) as {
      id?: string;
      brand_id?: string;
      name?: string | null;
      contact_name?: string | null;
      contact_email?: string | null;
    } | null;
    if (!client) throw new EventContextError("cliente inacessível no escopo atual");
    if (client.brand_id !== input.brandId) {
      throw new EventContextError("cliente não pertence à marca do evento");
    }
    clientId = client.id ?? null;
    put(out, "client.name", client.name);
    put(out, "client.contact_name", client.contact_name);
    put(out, "client.email", client.contact_email);
  }

  // ---- user ----
  put(out, "user.full_name", input.user?.fullName);
  put(out, "user.email", input.user?.email);
  put(out, "user.role", roleLabel(input.user?.role));
  if (input.userId) {
    if (!out["user.full_name"]) {
      const profRes = await supabase
        .from("user_profiles")
        .select("id, full_name")
        .eq("id", input.userId)
        .maybeSingle();
      put(out, "user.full_name", (profRes?.data as { full_name?: string | null } | null)?.full_name);
    }
    if (!out["user.role"]) {
      const memberRes = await supabase
        .from("brand_members")
        .select("role")
        .eq("brand_id", input.brandId)
        .eq("user_id", input.userId)
        .maybeSingle();
      put(out, "user.role", roleLabel((memberRes?.data as { role?: string } | null)?.role));
    }
  }

  // ---- invite ----
  // Links SEMPRE derivados da instalação do WORKSPACE do evento: host da
  // requisição quando existe, `brands.app_url` em cron/jobs/workers. Nunca de
  // env compartilhado entre instalações.
  const inviteUrl =
    input.invite?.url ??
    (input.invite?.token
      ? await tryInstallationAbsoluteUrl(supabase, input.brandId, `/invite/${input.invite.token}`)
      : null);
  put(out, "invite.url", inviteUrl);
  put(out, "invite.role", roleLabel(input.invite?.role));
  put(out, "invite.password", input.invite?.password);

  // ---- portal ----
  let portalToken = input.portal?.token ?? null;
  let portalExpires = input.portal?.expiresAt ?? null;
  if (!input.portal?.url && !portalToken && clientId) {
    const tokenRes = await supabase
      .from("portal_tokens")
      .select("token, expires_at, revoked_at, created_at")
      .eq("client_id", clientId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = ((tokenRes?.data ?? []) as Array<{ token?: string; expires_at?: string | null }>)[0];
    if (row?.token) {
      portalToken = row.token;
      portalExpires = portalExpires ?? row.expires_at ?? null;
    }
  }
  const portalUrl =
    input.portal?.url ??
    (portalToken
      ? await tryInstallationAbsoluteUrl(supabase, input.brandId, `/portal/${portalToken}`)
      : null);
  put(out, "portal.url", portalUrl);
  put(out, "portal.expires_at", formatDate(portalExpires));

  // ---- post / task / report ----
  put(out, "post.title", input.post?.title);
  put(out, "post.channel", input.post?.channel);
  put(out, "post.scheduled_at", formatDate(input.post?.scheduledAt, true));
  put(out, "task.title", input.task?.title);
  put(out, "task.due_at", formatDate(input.task?.dueAt));
  put(out, "report.period", input.report?.period);
  put(out, "report.approved_count", input.report?.approvedCount);
  put(out, "report.published_count", input.report?.publishedCount);
  put(out, "report.top_post", input.report?.topPost);

  return out;
}

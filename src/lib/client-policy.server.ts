// ⚠️ Server-only: fonte única das regras por cliente.
//
// Toda decisão "o cliente precisa aprovar?" e "o limite bloqueia?" passa por
// aqui — nunca lendo `clients.approval_policy` / `scope_policy` solto.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clientApprovalRequired,
  defaultApprovalPolicy,
  defaultScopePolicy,
  normalizeApprovalPolicy,
  normalizeScopePolicy,
  scopeBlocks,
  type ApprovalPolicy,
  type ApprovalStage,
  type ScopeFront,
  type ScopePolicy,
} from "@/lib/client-policy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

type PolicyRow = {
  approval_policy?: unknown;
  scope_policy?: unknown;
  overage_policy?: unknown;
  brand_id?: string | null;
};

async function loadRows(
  supabase: Db,
  args: { brandId?: string | null; clientId?: string | null },
): Promise<{ client: PolicyRow | null; brand: PolicyRow | null; brandId: string | null }> {
  const clientRes = args.clientId
    ? await supabase
        .from("clients")
        .select("brand_id, approval_policy, scope_policy, overage_policy")
        .eq("id", args.clientId)
        .maybeSingle()
    : { data: null };
  const client = (clientRes.data ?? null) as PolicyRow | null;
  const brandId = args.brandId ?? client?.brand_id ?? null;
  const brandRes = brandId
    ? await supabase
        .from("brands")
        .select("approval_policy, scope_policy, overage_policy")
        .eq("id", brandId)
        .maybeSingle()
    : { data: null };
  return { client, brand: (brandRes.data ?? null) as PolicyRow | null, brandId };
}

/** Política de aprovação efetiva (cliente → workspace → padrão histórico). */
export async function resolveClientApprovalPolicy(
  supabase: Db,
  args: { brandId?: string | null; clientId?: string | null },
): Promise<ApprovalPolicy> {
  if (!args.clientId && !args.brandId) return defaultApprovalPolicy();
  try {
    const { client, brand } = await loadRows(supabase, args);
    return normalizeApprovalPolicy(client?.approval_policy, brand?.approval_policy);
  } catch (err) {
    // Fail-safe: na dúvida, mantém o comportamento histórico (cliente aprova).
    console.warn("[client-policy] approval resolve failed", err);
    return defaultApprovalPolicy();
  }
}

/** Atalho: esta etapa ainda exige aprovação do cliente? */
export async function requiresClientApproval(
  supabase: Db,
  args: { brandId?: string | null; clientId?: string | null },
  stage: ApprovalStage,
): Promise<boolean> {
  const policy = await resolveClientApprovalPolicy(supabase, args);
  return clientApprovalRequired(policy, stage);
}

/** Política de limite efetiva (cliente → workspace → legado → padrão). */
export async function resolveClientScopePolicy(
  supabase: Db,
  args: { brandId?: string | null; clientId?: string | null },
): Promise<ScopePolicy> {
  if (!args.clientId && !args.brandId) return defaultScopePolicy();
  try {
    const { client, brand } = await loadRows(supabase, args);
    return normalizeScopePolicy({
      clientScope: client?.scope_policy,
      brandScope: brand?.scope_policy,
      clientLegacy: client?.overage_policy,
      brandLegacy: brand?.overage_policy,
    });
  } catch (err) {
    console.warn("[client-policy] scope resolve failed", err);
    return defaultScopePolicy();
  }
}

/** O limite bloqueia esta frente para este cliente? */
export async function scopeBlocksFront(
  supabase: Db,
  args: { brandId?: string | null; clientId?: string | null },
  front: ScopeFront,
): Promise<boolean> {
  const policy = await resolveClientScopePolicy(supabase, args);
  return scopeBlocks(policy, front);
}

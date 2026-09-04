/**
 * Fase 1 da unificação de estágio das peças.
 *
 * `posts.stage_id` (FK -> content_pipeline_stages) é a FONTE OPERACIONAL do
 * estágio. `posts.stage` (enum post_stage) permanece como campo LEGADO, ainda
 * consumido por telas/queries antigas (Projeto, Production Report, dashboard) e
 * pelo trigger `notify_post_approval_events`.
 *
 * Este módulo é o ÚNICO ponto canônico de derivação `stage_id -> stage` no app.
 * Há também uma garantia equivalente no banco (função `public.derive_post_stage`
 * + trigger `posts_sync_legacy_stage`), que cobre escritas em massa e escritas
 * fora do app. As duas implementações seguem exatamente a mesma regra.
 */

export type LegacyPostStage =
  | "idea"
  | "production"
  | "review"
  | "approved"
  | "scheduled"
  | "published";

const ENUM_KEYS = new Set<LegacyPostStage>([
  "idea",
  "production",
  "review",
  "approved",
  "scheduled",
  "published",
]);

export type StageShape = { key?: string | null; is_terminal?: boolean | null };

/**
 * Deriva o valor legado de `posts.stage` a partir da coluna do pipeline.
 *
 * Regra:
 * - key ∈ enum post_stage -> usa a key diretamente;
 * - stage customizado terminal -> "scheduled" (mantém o comportamento legado);
 * - qualquer outro stage customizado (ou stage inexistente) -> preserva o valor
 *   atual. NUNCA inventamos um valor de enum para colunas customizadas.
 */
export function deriveLegacyStage(
  stage: StageShape | null | undefined,
  current: LegacyPostStage | string | null | undefined,
): LegacyPostStage | null {
  const fallback =
    current && ENUM_KEYS.has(current as LegacyPostStage) ? (current as LegacyPostStage) : null;
  if (!stage) return fallback;
  const key = (stage.key ?? "").toLowerCase() as LegacyPostStage;
  if (ENUM_KEYS.has(key)) return key;
  if (stage.is_terminal) return "scheduled";
  return fallback;
}

/**
 * Busca o stage do pipeline e devolve o valor legado correspondente.
 * Retorna `null` quando não há valor seguro a gravar (nesse caso o chamador
 * simplesmente não inclui `stage` no patch).
 */
export async function resolveLegacyStage(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  stageId: string | null | undefined,
  current?: LegacyPostStage | string | null,
): Promise<LegacyPostStage | null> {
  if (!stageId) return null;
  const { data } = await supabase
    .from("content_pipeline_stages")
    .select("key, is_terminal")
    .eq("id", stageId)
    .maybeSingle();
  return deriveLegacyStage(data as StageShape | null, current ?? null);
}

/**
 * Caminho inverso: dado o pipeline da peça, devolve o `stage_id` da coluna cuja
 * `key` corresponde (na ordem de preferência informada). Usado pelos fluxos que
 * antes escreviam somente o campo legado `posts.stage` (wizard de agendamento /
 * publicação), garantindo que a coluna do Kanban acompanhe o estado real.
 *
 * Retorna `null` quando o pipeline não tem coluna equivalente — nesse caso o
 * chamador não deve incluir `stage_id` no patch.
 */
export async function resolveStageIdByKey(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  pipelineId: string | null | undefined,
  keys: string[],
): Promise<string | null> {
  if (!pipelineId || !keys.length) return null;
  const { data } = await supabase
    .from("content_pipeline_stages")
    .select("id, key, is_terminal")
    .eq("pipeline_id", pipelineId);
  const rows = (data ?? []) as Array<{
    id: string;
    key: string | null;
    is_terminal: boolean | null;
  }>;
  for (const key of keys) {
    const hit = rows.find((r) => (r.key ?? "").toLowerCase() === key.toLowerCase());
    if (hit) return hit.id;
  }
  return null;
}

/**
 * Mapa `stage_id -> {key, is_terminal}` para um conjunto de peças.
 * Usado por telas/relatórios que precisam do estágio REAL (coluna do pipeline)
 * e não apenas do enum legado `posts.stage`.
 */
export async function loadStageMap(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  stageIds: Array<string | null | undefined>,
): Promise<Map<string, { key: string; is_terminal: boolean }>> {
  const ids = Array.from(new Set(stageIds.filter((v): v is string => !!v)));
  const out = new Map<string, { key: string; is_terminal: boolean }>();
  if (!ids.length) return out;
  const { data } = await supabase
    .from("content_pipeline_stages")
    .select("id, key, is_terminal")
    .in("id", ids);
  for (const r of (data ?? []) as Array<{
    id: string;
    key: string | null;
    is_terminal: boolean | null;
  }>) {
    out.set(r.id, { key: (r.key ?? "").toLowerCase(), is_terminal: !!r.is_terminal });
  }
  return out;
}

/**
 * Estágio efetivo de uma peça: a `key` da coluna do pipeline quando existir,
 * com fallback no enum legado `posts.stage`.
 */
export function effectiveStage(
  stageId: string | null | undefined,
  legacyStage: string | null | undefined,
  stageMap: Map<string, { key: string; is_terminal: boolean }>,
): string {
  const stage = stageId ? stageMap.get(stageId) : undefined;
  if (stage?.key) return stage.key;
  return String(legacyStage ?? "").toLowerCase();
}

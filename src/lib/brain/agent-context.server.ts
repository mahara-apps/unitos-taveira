// Seleção de contexto do Brain POR AGENTE, com orçamento de tokens.
//
// Regra: o agente não recebe "tudo o que o Brain sabe" — recebe apenas as
// memórias consolidadas (padrões/preferências) cuja categoria é útil para a
// tarefa dele, ordenadas por relevância = confiança × recência, e cortadas
// por um orçamento de caracteres (~4 chars ≈ 1 token).
import type { SupabaseClient } from "@supabase/supabase-js";

/** Perfis de contexto por agente: categorias úteis e orçamento. */
export const AGENT_PROFILES: Record<string, { categories: string[]; budgetChars: number }> = {
  copywriter_senior: {
    categories: [
      "tom_de_voz",
      "preferencia_do_cliente",
      "desempenho_por_canal",
      "desempenho_por_formato",
      "mix_de_canais",
      "padrao_de_aprovacao",
      "approval_pattern",
      "retrabalho",
      "rework_pattern",
    ],
    budgetChars: 1800,
  },
  roteirista_social: {
    categories: [
      "tom_de_voz",
      "desempenho_por_formato",
      "desempenho_por_canal",
      "preferencia_do_cliente",
      "retrabalho",
      "rework_pattern",
    ],
    budgetChars: 1400,
  },
  art_director_social: {
    categories: [
      "preferencia_do_cliente",
      "desempenho_por_formato",
      "desempenho_por_canal",
      "retrabalho",
      "rework_pattern",
    ],
    budgetChars: 1200,
  },
  pauta: {
    categories: [
      "desempenho_por_canal",
      "desempenho_por_formato",
      "mix_de_canais",
      "preferencia_do_cliente",
      "padrao_de_aprovacao",
      "approval_pattern",
      "tom_de_voz",
    ],
    budgetChars: 2200,
  },
};

const DEFAULT_PROFILE = { categories: [] as string[], budgetChars: 1200 };

export interface BrainAgentContext {
  /** Markdown pronto para injeção no prompt (vazio quando não há aprendizado). */
  markdown: string;
  /** Quantas memórias entraram no pacote. */
  used: number;
  /** Quantas foram candidatas antes do corte por orçamento. */
  candidates: number;
  /** Escopos representados (global/brand/client). */
  scopes: string[];
}

interface MemoryRow {
  id: string;
  scope: string | null;
  category: string | null;
  title: string | null;
  description: string | null;
  confidence: number | null;
  last_observed_at: string | null;
  updated_at: string | null;
  content: Record<string, unknown> | null;
}

const HALF_LIFE_DAYS = 45;

function recency(iso: string | null): number {
  if (!iso) return 0.4;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return 1;
  return Math.exp((-Math.LN2 * days) / HALF_LIFE_DAYS);
}

function sampleOf(row: MemoryRow): number {
  const raw = row.content?.["sample"];
  const n = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Carrega o contexto consolidado do Brain para um agente específico.
 * Nunca lança: em caso de falha devolve pacote vazio (o agente segue com o
 * briefing normal, apenas sem reforço de aprendizado).
 */
export async function loadBrainAgentContext(
  admin: SupabaseClient,
  args: { brandId: string; clientId?: string | null; agent: string },
): Promise<BrainAgentContext> {
  const profile = AGENT_PROFILES[args.agent] ?? DEFAULT_PROFILE;
  const empty: BrainAgentContext = { markdown: "", used: 0, candidates: 0, scopes: [] };

  try {
    let q = admin
      .from("brain_memory")
      .select(
        "id, scope, category, title, description, confidence, last_observed_at, updated_at, content",
      )
      .eq("status", "active")
      .gte("confidence", 0.25)
      .order("confidence", { ascending: false })
      .limit(40);

    // Escopagem rígida: global (anônimo) + marca + cliente atual.
    const scopeFilter = [
      "and(scope.eq.global,brand_id.is.null)",
      `and(scope.eq.brand,brand_id.eq.${args.brandId})`,
      args.clientId ? `and(scope.eq.client,client_id.eq.${args.clientId})` : null,
    ]
      .filter(Boolean)
      .join(",");
    q = q.or(scopeFilter);
    if (profile.categories.length) q = q.in("category", profile.categories);

    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as MemoryRow[];
    if (!rows.length) return empty;

    const scored = rows
      .map((r) => {
        const conf = r.confidence ?? 0;
        const rec = recency(r.last_observed_at ?? r.updated_at);
        // Memória do cliente pesa mais que da marca, que pesa mais que global.
        const scopeWeight = r.scope === "client" ? 1 : r.scope === "brand" ? 0.9 : 0.7;
        return { row: r, score: conf * (0.65 + 0.35 * rec) * scopeWeight };
      })
      .sort((a, b) => b.score - a.score);

    const lines: string[] = [];
    const scopes = new Set<string>();
    let spent = 0;
    for (const { row, score } of scored) {
      const title = (row.title ?? "").trim();
      const desc = (row.description ?? "").trim();
      if (!title && !desc) continue;
      const sample = sampleOf(row);
      const line =
        `- **${title || row.category}** ` +
        `(${row.scope === "client" ? "cliente" : row.scope === "brand" ? "marca" : "agregado"}` +
        `, confiança ${Math.round((row.confidence ?? 0) * 100)}%` +
        `${sample ? `, base ${sample}` : ""}): ${desc}`;
      if (spent + line.length > profile.budgetChars) continue;
      spent += line.length;
      lines.push(line);
      scopes.add(row.scope ?? "brand");
      if (lines.length >= 8) break;
      void score;
    }

    if (!lines.length) return { ...empty, candidates: scored.length };

    return {
      markdown:
        `## Aprendizado consolidado (Brain)\n` +
        `Padrões observados no histórico real desta conta. Use como orientação; ` +
        `NÃO cite números internos na copy e não invente fatos além destes.\n` +
        lines.join("\n"),
      used: lines.length,
      candidates: scored.length,
      scopes: [...scopes],
    };
  } catch (err) {
    console.warn(
      `[brain] contexto do agente ${args.agent} indisponível: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return empty;
  }
}

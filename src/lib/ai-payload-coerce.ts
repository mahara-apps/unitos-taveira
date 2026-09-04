/**
 * Coerção tolerante de payloads de IA.
 *
 * Modelos diferentes descrevem o mesmo campo como string, lista de strings ou
 * objeto aninhado. Sem tolerância, um fallback de provedor devolve conteúdo
 * perfeitamente útil e a etapa falha com "sem conteúdo". Estes helpers
 * achatam qualquer uma dessas formas em texto/lista antes da validação.
 */

type AnyRec = Record<string, unknown>;

const clean = (s: string): string => s.trim();

/** Achata string | número | lista | objeto em texto legível. */
export function asText(v: unknown, depth = 0): string {
  if (typeof v === "string") return clean(v);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (depth > 2 || v == null) return "";
  if (Array.isArray(v)) {
    return v
      .map((x) => asText(x, depth + 1))
      .filter((s) => s.length > 0)
      .join("; ");
  }
  if (typeof v === "object") {
    return Object.entries(v as AnyRec)
      .map(([k, val]) => {
        const text = asText(val, depth + 1);
        return text ? `${k.replace(/_/g, " ")}: ${text}` : "";
      })
      .filter((s) => s.length > 0)
      .join(" | ");
  }
  return "";
}

/** Primeiro valor não vazio entre vários candidatos, como texto. */
export function firstText(...values: unknown[]): string {
  for (const v of values) {
    const text = asText(v);
    if (text.length > 0) return text;
  }
  return "";
}

/** Achata em lista de strings; string única vira lista de um item. */
export function asList(v: unknown): string[] {
  if (typeof v === "string") return clean(v) ? [clean(v)] : [];
  if (Array.isArray(v)) {
    return v.map((x) => asText(x)).filter((s) => s.length > 0);
  }
  if (v && typeof v === "object") {
    return Object.values(v as AnyRec)
      .map((x) => asText(x))
      .filter((s) => s.length > 0);
  }
  return [];
}

/** Primeira lista não vazia entre vários candidatos. */
export function firstList(...values: unknown[]): string[] {
  for (const v of values) {
    const list = asList(v);
    if (list.length > 0) return list;
  }
  return [];
}

export type NormalizedCohort = {
  name: string;
  target_personas: string[];
  behavioral_traits: string;
  content_strategy: string;
  conversion_criteria: string;
};

/** Normaliza o payload de cohorts aceitando aliases PT-BR/EN e formatos variados. */
export function normalizeCohorts(raw: unknown): { cohorts: NormalizedCohort[] } {
  const r = raw as AnyRec | AnyRec[] | undefined;
  const arr: AnyRec[] = Array.isArray(r)
    ? (r as AnyRec[])
    : Array.isArray((r as AnyRec | undefined)?.cohorts)
      ? ((r as AnyRec).cohorts as AnyRec[])
      : Array.isArray((r as AnyRec | undefined)?.coortes)
        ? ((r as AnyRec).coortes as AnyRec[])
        : [];
  return {
    cohorts: arr
      .filter((c): c is AnyRec => !!c && typeof c === "object")
      .map((c) => ({
        name: firstText(c.name, c.nome, c.titulo, c.title) || "Cohort",
        target_personas: firstList(c.target_personas, c.personas_alvo, c.personas, c.publico),
        behavioral_traits: firstText(
          c.behavioral_traits,
          c.traits,
          c.comportamento,
          c.tracos_comportamentais,
          c.perfil_comportamental,
          c.caracteristicas,
          c.descricao,
          c.description,
        ),
        content_strategy: firstText(
          c.content_strategy,
          c.estrategia_conteudo,
          c.estrategia_de_conteudo,
          c.estrategia,
          c.strategy,
        ),
        conversion_criteria: firstText(
          c.conversion_criteria,
          c.criterio_conversao,
          c.criterio_de_conversao,
          c.criterios_de_conversao,
          c.criterios_conversao,
          c.criterio,
          c.conversao,
        ),
      })),
  };
}

/** Chaves recebidas — diagnóstico sem expor conteúdo. */
export function describePayloadKeys(raw: unknown): string {
  if (Array.isArray(raw)) {
    const first = raw.find((x) => x && typeof x === "object");
    return `array(${raw.length})${first ? ` item:{${Object.keys(first as AnyRec).join(",")}}` : ""}`;
  }
  if (raw && typeof raw === "object") return `{${Object.keys(raw as AnyRec).join(",")}}`;
  return typeof raw;
}

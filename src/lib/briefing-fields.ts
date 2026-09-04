/**
 * FASE 3 — Catálogo canônico dos campos de briefing que podem ser solicitados
 * ao cliente. É a MESMA estrutura de `clients.brand_hub` (fonte única): cada
 * item aponta para uma chave real do hub, então a resposta do cliente já chega
 * no formato do briefing oficial (mas como proposta, nunca aplicada direto).
 *
 * Módulo client-safe: usado pela tela da agência e pelo Portal.
 */

export type BriefingFieldType = "text" | "textarea" | "list";

export type BriefingField = {
  /** Chave em clients.brand_hub. */
  key: string;
  label: string;
  hint?: string;
  type: BriefingFieldType;
  block: BriefingBlockId;
};

export type BriefingBlockId = "identidade" | "produto" | "publico" | "estetica" | "metas";

export const BRIEFING_BLOCKS: Array<{ id: BriefingBlockId; label: string }> = [
  { id: "identidade", label: "Identidade" },
  { id: "produto", label: "Produto e oferta" },
  { id: "publico", label: "Público" },
  { id: "estetica", label: "Estética e linguagem" },
  { id: "metas", label: "Metas" },
];

export const BRIEFING_FIELDS: BriefingField[] = [
  { key: "description", label: "Descrição do negócio", type: "textarea", block: "identidade" },
  { key: "mission", label: "Missão", type: "textarea", block: "identidade" },
  { key: "positioning", label: "Posicionamento", type: "textarea", block: "identidade" },
  { key: "values", label: "Valores", type: "textarea", block: "identidade" },
  { key: "offer", label: "Oferta principal", type: "textarea", block: "produto" },
  { key: "price_range", label: "Faixa de preço", type: "text", block: "produto" },
  { key: "differentials", label: "Diferenciais", type: "textarea", block: "produto" },
  { key: "objections", label: "Objeções comuns", type: "textarea", block: "produto" },
  { key: "audience", label: "Descrição do público", type: "textarea", block: "publico" },
  { key: "demographics", label: "Dados demográficos", type: "textarea", block: "publico" },
  { key: "pain_points", label: "Dores", type: "textarea", block: "publico" },
  { key: "desires", label: "Desejos", type: "textarea", block: "publico" },
  { key: "journey", label: "Jornada do cliente", type: "textarea", block: "publico" },
  { key: "tone_text", label: "Tom de voz", type: "textarea", block: "estetica" },
  {
    key: "hashtags",
    label: "Hashtags de referência",
    hint: "Uma por linha, sem #",
    type: "list",
    block: "estetica",
  },
  { key: "goals", label: "Metas e restrições", type: "textarea", block: "metas" },
];

const BY_KEY = new Map(BRIEFING_FIELDS.map((f) => [f.key, f]));

export const BRIEFING_FIELD_KEYS: string[] = BRIEFING_FIELDS.map((f) => f.key);

export function briefingField(key: string): BriefingField | undefined {
  return BY_KEY.get(key);
}

export function briefingFieldLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Mantém apenas chaves reconhecidas (defesa contra payload arbitrário). */
export function sanitizeRequestedFields(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    if (!BY_KEY.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * Normaliza a resposta do cliente para o formato do hub, considerando apenas
 * os campos efetivamente solicitados.
 */
export function sanitizeProposalPayload(
  raw: Record<string, unknown>,
  requestedFields: string[],
): Record<string, string | string[]> {
  const allowed = new Set(sanitizeRequestedFields(requestedFields));
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) continue;
    const field = BY_KEY.get(key)!;
    if (field.type === "list") {
      const list = (Array.isArray(value) ? value : String(value ?? "").split(/\n|,|;/))
        .map((v) =>
          String(v ?? "")
            .trim()
            .replace(/^#/, ""),
        )
        .filter(Boolean)
        .slice(0, 30);
      if (list.length) out[key] = list;
      continue;
    }
    const text = String(value ?? "")
      .trim()
      .slice(0, 5000);
    if (text) out[key] = text;
  }
  return out;
}

export const BRIEFING_REQUEST_STATUS_LABEL: Record<string, string> = {
  requested: "Aguardando cliente",
  submitted: "Respondido",
  in_review: "Em revisão",
  approved: "Aprovado",
};

export const BRIEFING_REVIEW_DECISION_LABEL: Record<string, string> = {
  approved: "Aprovado",
  partial: "Aprovado parcialmente",
  changes_requested: "Complementação solicitada",
};

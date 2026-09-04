import { z } from "zod";

export const BriefingFieldsSchema = z.object({
  description: z.string().nullable(),
  mission: z.string().nullable(),
  positioning: z.string().nullable(),
  values: z.string().nullable(),
  audience: z.string().nullable(),
  pain_points: z.string().nullable(),
  demographics: z.string().nullable(),
  offer: z.string().nullable(),
  differentials: z.string().nullable(),
  objections: z.string().nullable(),
  journey: z.string().nullable(),
  desires: z.string().nullable(),
  tone_text: z.string().nullable(),
  hashtags: z.array(z.string()).nullable(),
  goals: z.string().nullable(),
});

export const BriefingEvidenceSchema = z.object({
  field: z.string(),
  excerpt: z.string().nullable(),
  conflict: z.boolean().nullable(),
  confidence: z.number().nullable(),
});

export const BriefingSpeakerSchema = z.object({
  name: z.string().nullable(),
  role: z.string().nullable(),
  evidence: z.string().nullable(),
  needs_review: z.boolean().nullable(),
});

/**
 * Contrato enviado aos providers. Todos os campos declarados são obrigatórios
 * no JSON Schema; ausência semântica usa null/arrays vazios. Isso mantém o
 * response_format portátil entre Gemini e providers OpenAI-compatible.
 */
export const BriefingAnalysisSchema = z.object({
  executive_summary: z.string().nullable(),
  material_type: z.string().nullable(),
  extracted_text: z.string().nullable(),
  briefing: BriefingFieldsSchema,
  evidence: z.array(BriefingEvidenceSchema),
  speakers: z.array(BriefingSpeakerSchema),
  confidence: z.number().nullable(),
});

export type BriefingAnalysis = z.infer<typeof BriefingAnalysisSchema>;

const RecoverableBriefingAnalysisSchema = z.object({
  executive_summary: z.string().nullable(),
  material_type: z.string().nullable(),
  extracted_text: z.string().nullable().optional(),
  briefing: BriefingFieldsSchema.partial(),
  evidence: z.array(BriefingEvidenceSchema.partial()).optional(),
  speakers: z.array(BriefingSpeakerSchema.partial()).optional(),
  confidence: z.number().nullable().optional(),
});

const EMPTY_BRIEFING: z.infer<typeof BriefingFieldsSchema> = {
  description: null,
  mission: null,
  positioning: null,
  values: null,
  audience: null,
  pain_points: null,
  demographics: null,
  offer: null,
  differentials: null,
  objections: null,
  journey: null,
  desires: null,
  tone_text: null,
  hashtags: null,
  goals: null,
};

/** Normaliza apenas metadados historicamente omitidos; campos centrais seguem obrigatórios. */
export function normalizeBriefingAnalysis(value: unknown): BriefingAnalysis | null {
  const parsed = RecoverableBriefingAnalysisSchema.safeParse(value);
  if (!parsed.success) return null;
  const clip = (text: string | null | undefined, max: number) =>
    typeof text === "string" ? text.slice(0, max) : null;
  const clampConfidence = (confidence: number | null | undefined) =>
    typeof confidence === "number" && Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : null;
  const briefing = { ...EMPTY_BRIEFING, ...parsed.data.briefing };
  for (const [key, field] of Object.entries(briefing)) {
    if (key === "hashtags") {
      briefing.hashtags = Array.isArray(field)
        ? field.slice(0, 30).map((tag) => tag.slice(0, 80))
        : null;
    } else {
      (briefing as Record<string, unknown>)[key] = clip(field as string | null, 700);
    }
  }
  return BriefingAnalysisSchema.parse({
    ...parsed.data,
    executive_summary: clip(parsed.data.executive_summary, 400),
    material_type: clip(parsed.data.material_type, 120),
    briefing,
    extracted_text: clip(parsed.data.extracted_text, 4_000),
    evidence: (parsed.data.evidence ?? []).slice(0, 20)
      .filter((item) => typeof item.field === "string" && item.field.length > 0)
      .map((item) => ({
        field: item.field as string,
        excerpt: clip(item.excerpt, 300),
        conflict: item.conflict ?? null,
        confidence: clampConfidence(item.confidence),
      })),
    speakers: (parsed.data.speakers ?? []).slice(0, 20).map((item) => ({
      name: clip(item.name, 160),
      role: clip(item.role, 80),
      evidence: clip(item.evidence, 300),
      needs_review: item.needs_review ?? null,
    })),
    confidence: clampConfidence(parsed.data.confidence),
  });
}

export function effectiveProviderAttempt(
  attempts: Array<{ provider: string; model: string; result: string }>,
  fallback: { provider: string; model: string },
): { provider: string; model: string } {
  const successful = [...attempts].reverse().find((attempt) => attempt.result === "success");
  const latest = successful ?? attempts[attempts.length - 1];
  return latest ? { provider: latest.provider, model: latest.model } : fallback;
}
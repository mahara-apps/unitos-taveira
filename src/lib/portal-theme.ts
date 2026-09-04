import { z } from "zod";

/**
 * Fase 3 — tema visual do portal público (clients.portal_theme jsonb).
 *
 * O jsonb vai direto para `style` na rota pública, então TODO valor passa por
 * este schema antes de ser aplicado (hex de cor e URL http(s) validados).
 * Qualquer campo inválido é descartado e cai no fallback do sistema.
 */

const hex = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "cor deve ser um hex (#RGB ou #RRGGBB)");

// Aceita URL absoluta http(s) OU caminho relativo à raiz ("/..."), usado pelos
// assets internos do sistema (clients.logo_url costuma ser "/__l5e/...").
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => /^https?:\/\//i.test(v) || /^\/[^/]/.test(v),
    "URL deve começar com http(s):// ou /",
  );

// Aceita string vazia (campo limpo no formulário) tratando-a como "sem logo".
const httpUrlOrEmpty = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  httpUrl.nullish(),
);

export const portalThemeSchema = z.object({
  mode: z.enum(["system", "custom"]).default("system"),
  accent: hex.nullish(),
  logo_url: httpUrlOrEmpty,

  bg: hex.nullish(),
  dark: z.boolean().nullish(),
  footer_label: z.string().trim().max(80).nullish(),
  show_agency_credit: z.boolean().nullish(),
});

export type PortalTheme = z.infer<typeof portalThemeSchema>;

export const DEFAULT_PORTAL_THEME: PortalTheme = { mode: "system" };

/**
 * Normaliza um jsonb desconhecido em um tema seguro. Nunca lança:
 * dado corrompido/legado volta para o modo padrão do sistema.
 */
export function normalizePortalTheme(raw: unknown): PortalTheme {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_PORTAL_THEME };
  const parsed = portalThemeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // Parse tolerante: mantém só os campos individualmente válidos.
  const src = raw as Record<string, unknown>;
  const out: PortalTheme = { mode: src["mode"] === "custom" ? "custom" : "system" };
  const pick = <T>(schema: z.ZodType<T>, key: keyof PortalTheme) => {
    const r = schema.safeParse(src[key as string]);
    if (r.success) (out as Record<string, unknown>)[key as string] = r.data;
  };
  pick(hex, "accent");
  pick(httpUrlOrEmpty as unknown as z.ZodType<string | null | undefined>, "logo_url");
  pick(hex, "bg");
  pick(z.boolean(), "dark");
  pick(z.string().trim().max(80), "footer_label");
  pick(z.boolean(), "show_agency_credit");
  return out;
}

/** Tema efetivo: só aplica customização quando mode === "custom". */
export function resolvePortalTheme(
  theme: PortalTheme | null | undefined,
  fallback: { color?: string | null; logoUrl?: string | null; agencyName?: string | null },
): {
  accent: string;
  logoUrl: string | null;
  bg: string | null;
  dark: boolean;
  footerLabel: string | null;
  showAgencyCredit: boolean;
} {
  const custom = theme?.mode === "custom" ? theme : null;
  return {
    accent: custom?.accent || fallback.color || "var(--primary)",
    logoUrl: custom?.logo_url ?? null,
    bg: custom?.bg ?? null,
    dark: custom?.dark ?? false,
    footerLabel:
      custom?.footer_label || (fallback.agencyName ? `por ${fallback.agencyName}` : null),
    showAgencyCredit: custom?.show_agency_credit ?? true,
  };
}

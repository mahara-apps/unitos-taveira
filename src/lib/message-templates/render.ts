/**
 * Renderização estrita de templates (isomórfica, sem acesso a banco).
 *
 * Diferente de `renderTemplateString` (que troca faltantes por "—" e serve ao
 * Preview), aqui uma variável sem resolução é ERRO: nenhum `{{...}}` cru e
 * nenhum "—" pode chegar ao provider em disparo real.
 */

export const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g;

export class TemplateRenderError extends Error {
  code = "variaveis_sem_contexto" as const;
  missing: string[];
  constructor(missing: string[]) {
    super(`variaveis_sem_contexto: ${missing.join(", ")}`);
    this.name = "TemplateRenderError";
    this.missing = missing;
  }
}

export function extractVariables(template: string): string[] {
  return Array.from(new Set([...template.matchAll(VARIABLE_RE)].map((m) => m[1] as string)));
}

/** Lista as variáveis do template que o contexto não resolve. */
export function missingVariables(
  template: string,
  context: Record<string, string | undefined>,
): string[] {
  return extractVariables(template).filter((key) => {
    const v = context[key];
    return v === undefined || v === null || String(v).trim() === "";
  });
}

/** Renderiza exigindo contexto completo. Lança `TemplateRenderError` se faltar. */
export function renderStrict(
  template: string,
  context: Record<string, string | undefined>,
): string {
  const missing = missingVariables(template, context);
  if (missing.length) throw new TemplateRenderError(missing);
  return template.replace(VARIABLE_RE, (_, key: string) => String(context[key]));
}

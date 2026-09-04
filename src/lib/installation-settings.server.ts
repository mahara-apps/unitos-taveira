/**
 * Configuração da INSTALAÇÃO (server-only, singleton `public.installation`).
 *
 * Modelo canônico do Unitos:
 * - `brands` = WORKSPACE/TENANT. Todo dado operacional (clientes, projetos,
 *   posts, tarefas, Brain, canais, templates, notificações, Portal) continua
 *   isolado por `brand_id`. Nada aqui substitui esse isolamento.
 * - `public.installation` = a INSTÂNCIA em si (1 linha por banco): domínio
 *   canônico, branding institucional (logo/ícone/logo de login) e remetente de
 *   e-mail padrão. Esses valores NÃO pertencem a nenhum workspace — antes eles
 *   moravam em colunas de `brands` e em envs (`LOGIN_BRAND_ID`,
 *   `LOGIN_BRAND_SLUG`), o que permitia a identidade do workspace A aparecer
 *   para o workspace B na mesma instalação.
 *
 * Regras:
 * - leitura pública (a tela de login precisa da logo antes de haver sessão);
 * - escrita SOMENTE Super Admin (policy no banco + `assertSuperAdmin` no
 *   servidor);
 * - nenhum fallback para outra instalação, outro workspace ou valor hardcoded:
 *   ausência de configuração devolve `null` e a UI usa o branding institucional
 *   local.
 */

export type InstallationSettings = {
  appUrl: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
  loginLogoUrl: string | null;
  emailFrom: string | null;
  emailFromName: string | null;
};

const EMPTY: InstallationSettings = {
  appUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  iconUrl: null,
  loginLogoUrl: null,
  emailFrom: null,
  emailFromName: null,
};

type Row = {
  app_url?: string | null;
  logo_url?: string | null;
  logo_dark_url?: string | null;
  icon_url?: string | null;
  login_logo_url?: string | null;
  email_from?: string | null;
  email_from_name?: string | null;
};

const CACHE_MS = 30_000;
let cache: { at: number; value: InstallationSettings } | null = null;

function map(row: Row | null): InstallationSettings {
  if (!row) return EMPTY;
  return {
    appUrl: row.app_url ?? null,
    logoUrl: row.logo_url ?? null,
    logoDarkUrl: row.logo_dark_url ?? null,
    iconUrl: row.icon_url ?? null,
    loginLogoUrl: row.login_logo_url ?? null,
    emailFrom: row.email_from ?? null,
    emailFromName: row.email_from_name ?? null,
  };
}

/** Lê o singleton. Nunca lança: falha de leitura devolve configuração vazia. */
export async function getInstallationSettings(
  opts?: { fresh?: boolean },
): Promise<InstallationSettings> {
  if (!opts?.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("installation")
      .select("app_url, logo_url, logo_dark_url, icon_url, login_logo_url, email_from, email_from_name")
      .limit(1)
      .maybeSingle();
    const value = map(((res as { data: unknown }).data as Row | null) ?? null);
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? EMPTY;
  }
}

/**
 * Atualiza o singleton. O chamador é responsável por exigir Super Admin antes
 * (a policy do banco também exige, mas aqui usamos service_role).
 */
export async function updateInstallationSettings(
  patch: Partial<Record<
    "app_url" | "logo_url" | "logo_dark_url" | "icon_url" | "login_logo_url" | "email_from" | "email_from_name",
    string | null
  >>,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("installation")
    .update(patch as never)
    .eq("id", true);
  if (error) throw new Error(error.message);
  cache = null;
}

/** Somente para testes: limpa o memo por worker. */
export function __resetInstallationSettingsCache(): void {
  cache = null;
}

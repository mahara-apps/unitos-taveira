import { createServerFn } from "@tanstack/react-start";

/**
 * Logo pública da TELA DE LOGIN.
 *
 * Fonte ÚNICA: o singleton `public.installation` (`login_logo_url`). A tela de
 * login é da INSTALAÇÃO, não de um workspace — por isso nunca mais se elege uma
 * marca por env (`LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG`) nem por heurística de
 * "instalação de marca única": com dois workspaces na mesma instância isso
 * exibia o branding de um workspace para usuários do outro.
 *
 * Segurança preservada:
 * - path validado estruturalmente antes de assinar (sem `..`, e apenas
 *   `<uuid>/arquivo` ou `installation/arquivo` no bucket privado
 *   `brand-assets`);
 * - URL assinada de vida curta (10 min);
 * - rate limit por IP na superfície pública;
 * - sem configuração ⇒ `null` e a UI usa o branding institucional local.
 */

const SAFE_PATH = /^(installation|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/[^/]+$/;

export function isSafeLoginLogoPath(path: string | null | undefined): boolean {
  const value = (path ?? "").trim();
  if (!value || value.includes("..")) return false;
  return SAFE_PATH.test(value);
}

export const getLoginLogoFn = createServerFn({ method: "GET" }).handler(async () => {
  const empty = { url: null as string | null };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { checkPublicRate, clientIp, rateKey } = await import("@/lib/public-rate-limit.server");

    let ip = "unknown";
    try {
      ip = clientIp(getRequest());
    } catch {
      /* fora de contexto de request: segue sem chave de IP */
    }
    const rate = await checkPublicRate(supabaseAdmin, rateKey("login-logo", ip), {
      max: 60,
      windowSeconds: 300,
      blockSeconds: 600,
    });
    if (rate.blocked) return empty;

    const { getInstallationSettings } = await import("@/lib/installation-settings.server");
    const { loginLogoUrl } = await getInstallationSettings();
    if (!isSafeLoginLogoPath(loginLogoUrl)) return empty;

    const signed = await supabaseAdmin.storage
      .from("brand-assets")
      .createSignedUrl(loginLogoUrl!, 600);
    return { url: signed.data?.signedUrl ?? null };
  } catch {
    return empty;
  }
});

/**
 * URL canônica da INSTALAÇÃO ATUAL (server-only).
 *
 * CAUSA RAIZ CORRIGIDA AQUI: a URL vinha de variável de ambiente
 * (`PUBLIC_APP_URL` / `APP_URL` / `APP_PUBLIC_URL`). Quando o `.env` é copiado
 * entre instalações — cenário real de multi-instalação do Unitos — todas as
 * instalações passam a gerar links do MESMO domínio, e o convite da instalação
 * A chega apontando para a instalação B.
 *
 * Nova ordem de resolução (determinística, por requisição):
 *   1. Host real da requisição que originou o evento (`x-forwarded-host`/`host`)
 *      — é sempre a própria instalação que está atendendo o usuário.
 *   2. Variável de ambiente, SOMENTE quando não existe requisição (cron/worker).
 *   3. Falha explícita (`AppUrlNotConfiguredError`). Nunca há fallback fixo,
 *      valor de exemplo ou domínio de outra instalação.
 *
 * Quando o env divergir do host da requisição, o host da requisição vence e a
 * divergência é registrada — o env é justamente o vetor do vazamento.
 */

export class AppUrlNotConfiguredError extends Error {
  code = "app_url_nao_configurada" as const;
  constructor() {
    super("app_url_nao_configurada");
    this.name = "AppUrlNotConfiguredError";
  }
}

function normalizeOrigin(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Origem derivada da requisição atual (fonte autoritativa da instalação). */
export async function requestOrigin(): Promise<string | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as {
      getRequestHeader?: (name: string) => string | undefined;
    };
    const get = mod.getRequestHeader;
    if (!get) return null;
    const host = get("x-forwarded-host") ?? get("host");
    if (!host) return null;
    const firstHost = host.split(",")[0]!.trim();
    const proto =
      get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      (firstHost.startsWith("localhost") || firstHost.startsWith("127.0.0.1") ? "http" : "https");
    return normalizeOrigin(`${proto}://${firstHost}`);
  } catch {
    // Fora de uma requisição (cron/worker/teste): não há host para derivar.
    return null;
  }
}

/** Origem configurada por env — último recurso fora de uma requisição. */
export function configuredOrigin(): string | null {
  return normalizeOrigin(
    process.env.PUBLIC_APP_URL ?? process.env.APP_PUBLIC_URL ?? process.env.APP_URL ?? null,
  );
}

/**
 * Origem persistida da INSTALAÇÃO (singleton `public.installation`).
 * É aprendida do host real das requisições, então cron/worker desta instância
 * reconstroem links do próprio domínio — nunca de env compartilhado.
 */
async function installationOrigin(): Promise<string | null> {
  try {
    const { getInstallationSettings } = await import("./installation-settings.server");
    const settings = await getInstallationSettings();
    return normalizeOrigin(settings.appUrl);
  } catch {
    return null;
  }
}

async function learnInstallationOrigin(origin: string): Promise<void> {
  try {
    const current = await installationOrigin();
    if (current === origin) return;
    const { updateInstallationSettings } = await import("./installation-settings.server");
    await updateInstallationSettings({ app_url: origin });
  } catch {
    /* ambiente sem banco (teste/dev): nada a aprender */
  }
}

/**
 * URL canônica da instalação atual. Lança quando não é possível determiná-la —
 * preferimos falhar do que enviar um link de outra instalação.
 */
export async function getPublicAppUrl(): Promise<string> {
  const fromRequest = await requestOrigin();
  if (fromRequest) {
    void learnInstallationOrigin(fromRequest);
    const fromEnv = configuredOrigin();
    if (fromEnv && fromEnv !== fromRequest) {
      console.warn(
        `[app-url] env aponta para outra instalação (${fromEnv}); usando o host da requisição (${fromRequest})`,
      );
    }
    return fromRequest;
  }
  const fromInstallation = await installationOrigin();
  if (fromInstallation) return fromInstallation;
  const fromEnv = configuredOrigin();
  if (fromEnv) return fromEnv;
  throw new AppUrlNotConfiguredError();
}


/** Igual a `getPublicAppUrl`, mas retorna null em vez de lançar. */
export async function tryGetPublicAppUrl(): Promise<string | null> {
  try {
    return await getPublicAppUrl();
  } catch {
    return null;
  }
}

/** Monta uma URL absoluta da instalação atual: `absoluteUrl("/invite/abc")`. */
export async function absoluteUrl(path: string): Promise<string> {
  const base = await getPublicAppUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Versão tolerante: retorna null quando a instalação não pôde ser resolvida. */
export async function tryAbsoluteUrl(path: string): Promise<string | null> {
  const base = await tryGetPublicAppUrl();
  if (!base) return null;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

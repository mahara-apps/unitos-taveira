import { getCachedUser } from "@/lib/auth-cache";
import { getMyPortalAccessFn, type PortalAccess } from "@/lib/portal-access.functions";
import { requireFeatureAccess } from "@/lib/feature-flags.functions";
import { subscribeActiveWorkspace } from "@/lib/active-workspace";


/**
 * Caches de gate de navegação (somente performance — nenhuma regra muda).
 *
 * Os gates de `beforeLoad` (portal x equipe, feature habilitada) rodavam a
 * cada navegação, encadeando roundtrips seriais antes de qualquer pixel da
 * nova tela. Aqui memorizamos o resultado por TTL curto e deduplicamos
 * chamadas concorrentes; o bloqueio real continua idêntico e o servidor segue
 * sendo a autoridade.
 */
const TTL_MS = 5 * 60_000;

type Entry<T> = { value: T; at: number };

function memo<T>(ttl = TTL_MS) {
  const store = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();
  return {
    /**
     * `load` pode marcar `cache: false` (ex.: resultado de timeout) para que um
     * fallback provisório não fique preso no cache pelo TTL inteiro.
     */
    async get(key: string, load: () => Promise<{ value: T; cache?: boolean }>): Promise<T> {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < ttl) return hit.value;
      const running = inflight.get(key);
      if (running) return running;
      const p = (async () => {
        try {
          const { value, cache = true } = await load();
          if (cache) store.set(key, { value, at: Date.now() });
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
    clear() {
      store.clear();
      inflight.clear();
    },
  };
}

const portalAccessCache = memo<PortalAccess | null>();
const featureGateCache = memo<FeatureAccessResult>();

/**
 * Nenhum gate pode prender a navegação: se a chamada não responder no prazo,
 * seguimos com o fallback permissivo do lado do cliente (o servidor continua
 * validando toda leitura/escrita via RLS e middlewares).
 */
async function withTimeout<T>(
  p: Promise<T>,
  fallback: T,
  ms = 6_000,
): Promise<{ value: T; cache?: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ value: T; cache: boolean }>((r) => {
    timer = setTimeout(() => r({ value: fallback, cache: false }), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Escopo de portal do usuário atual.
 *
 * `getMyPortalAccessFn` é protegida: sem sessão o bearer não existe e o
 * middleware lança "No authorization header". Por isso a identidade é
 * resolvida ANTES (via cache deduplicado, sem roundtrip extra) e sem usuário
 * devolvemos `null` — o gate então só redireciona para o login.
 */
export async function getCachedPortalAccess(): Promise<PortalAccess | null> {
  const user = await getCachedUser();
  if (!user) return null;
  return portalAccessCache.get("me", () =>
    withTimeout(
      getMyPortalAccessFn().catch(() => null),
      null,
    ),
  );
}


export type FeatureAccessReason =
  | "granted"
  | "feature_disabled"
  | "no_workspace"
  | "entitlement_error";

export type FeatureAccessResult = { enabled: boolean; reason: FeatureAccessReason };

/**
 * Resolve o entitlement de uma feature para o workspace ativo.
 *
 * Regras de cache:
 *  - sem workspace resolvido: NUNCA cacheia (o negativo não pode sobreviver à
 *    resolução do contexto);
 *  - erro/timeout: não cacheia e não é tratado como bloqueio de plano;
 *  - troca de workspace/identidade: cache limpo (ver `subscribeActiveWorkspace`
 *    abaixo e `clearAccessCaches`).
 */
export function getCachedFeatureAccess(
  brandId: string | null,
  featureKey: string,
): Promise<FeatureAccessResult> {
  if (!brandId) {
    return Promise.resolve({ enabled: false, reason: "no_workspace" });
  }
  return featureGateCache.get(`${brandId}:${featureKey}`, () =>
    withTimeout(
      requireFeatureAccess({ data: { brandId, featureKey } })
        .then(({ enabled, reason }): FeatureAccessResult => {
          if (enabled) return { enabled: true, reason: "granted" };
          return {
            enabled: false,
            reason: reason === "no_brand" ? "no_workspace" : "feature_disabled",
          };
        })
        .catch((): FeatureAccessResult => ({ enabled: true, reason: "entitlement_error" })),
      { enabled: true, reason: "entitlement_error" } as FeatureAccessResult,
    ).then((r) => ({
      ...r,
      // resultado provisório/erro não fica preso no TTL
      cache: r.cache !== false && r.value.reason !== "entitlement_error",
    })),
  );
}

/** Chamado ao alternar features ou trocar de identidade. */
export function clearAccessCaches(): void {
  portalAccessCache.clear();
  featureGateCache.clear();
}

/**
 * Qualquer mudança do workspace ativo (login, logout, troca de identidade,
 * troca de workspace) invalida os entitlements memorizados.
 */
subscribeActiveWorkspace(() => {
  featureGateCache.clear();
});

import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Cache de sessão do usuário (performance de navegação).
 *
 * `supabase.auth.getUser()` faz roundtrip de rede a cada chamada. Como o gate
 * do layout `_authenticated` roda em toda navegação — e vários componentes
 * pedem o usuário no mount — sem cache cada troca de tela paga 1+ requisição
 * serial antes de renderizar. Aqui deduplicamos por TTL curto, mantendo o
 * mesmo resultado funcional (token continua sendo validado no servidor).
 */
const TTL_MS = 60_000;

let cached: { user: User | null; at: number } | null = null;
let inflight: Promise<User | null> | null = null;

/** Timeout do gate: rede lenta/lock travado não pode prender a navegação. */
const TIMEOUT_MS = 6_000;

async function resolveUser(): Promise<User | null> {
  // Fallback local: se o refresh remoto travar, usamos a sessão já persistida
  // (o servidor revalida o bearer em toda chamada protegida).
  const local = supabase.auth
    .getSession()
    .then(({ data }) => data.session?.user ?? null)
    .catch(() => null);

  const remote = supabase.auth
    .getUser()
    .then(({ data, error }) => (error ? null : (data.user ?? null)))
    .catch(() => null);

  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), TIMEOUT_MS));
  const raced = await Promise.race([remote, timeout]);
  return raced === "timeout" ? await local : raced;
}

export async function getCachedUser(options?: { force?: boolean }): Promise<User | null> {
  if (!options?.force && cached && Date.now() - cached.at < TTL_MS) return cached.user;
  if (!options?.force && inflight) return inflight;

  inflight = (async () => {
    try {
      const user = await resolveUser();
      cached = { user, at: Date.now() };
      return user;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Invalida o cache — chamado em qualquer transição de identidade. */
export function clearCachedUser(): void {
  cached = null;
  inflight = null;
}

export const authUserQueryOptions = () => ({
  queryKey: ["auth", "user"] as const,
  queryFn: () => getCachedUser(),
  staleTime: TTL_MS,
});

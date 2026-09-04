import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { createRememberStorage } from "./remember-storage";

/**
 * Cliente Supabase do navegador.
 *
 * A instância é resolvida SOMENTE por variáveis de ambiente, para que cada
 * instalação (agência) aponte para o seu próprio projeto Supabase sem nenhuma
 * credencial fixa no código. No Vite/TanStack Start o build injeta
 * `import.meta.env.VITE_*`; durante o SSR (Vercel/Worker) também aceitamos os
 * equivalentes sem prefixo, disponíveis em `process.env`.
 */
function readEnv(...keys: string[]): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const nodeEnv: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env ? process.env : {};
  for (const key of keys) {
    const value = viteEnv[key] ?? nodeEnv[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * Fallback da instalação Unitos Master. A URL e a chave publicável (anon) são
 * públicas por definição — ficam aqui apenas para que o build não quebre quando
 * o `.env` não é versionado. Qualquer instalação nova sobrescreve via env.
 */
const DEFAULT_SUPABASE_URL = "https://tkjbhttylouamqxnbfgv.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRramJodHR5bG91YW1xeG5iZmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNTcyMDcsImV4cCI6MjA5ODczMzIwN30.bRyK6jhVUXU7dAC1BGQbd4bllBm-UgatOOQdkfk1EFA";

const SUPABASE_URL = readEnv("VITE_SUPABASE_URL", "SUPABASE_URL") ?? DEFAULT_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  readEnv(
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  ) ?? DEFAULT_SUPABASE_PUBLISHABLE_KEY;


// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

/**
 * O lock padrão do supabase-js usa Web Locks, que são compartilhados por
 * origem. Em iframes de preview (ou com a mesma aba aberta duas vezes) um lock
 * preso faz `getSession()`/`getUser()` nunca resolver — a tela fica no spinner
 * para sempre. Usamos um lock pass-through no navegador para evitar o deadlock.
 */
const passThroughLock = async <R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => fn();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: createRememberStorage(),
    persistSession: true,
    autoRefreshToken: true,
    lock: passThroughLock,
  },
});

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getActiveWorkspace,
  markActiveWorkspaceUnresolved,
  publishActiveWorkspace,
  subscribeActiveWorkspace,
  type WorkspaceStatus,
} from "@/lib/active-workspace";
import { shouldClearClientOnBrandChange } from "@/lib/workspace-context-rules";

type ActiveContextValue = {
  brandId: string | null;
  clientId: string | null;
  setBrandId: (id: string | null) => void;
  setClientId: (id: string | null) => void;
};

const Ctx = createContext<ActiveContextValue | null>(null);

const BRAND_KEY = "nx.brand";
const CLIENT_KEY = "nx.client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const readUuid = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(key);
  if (v && UUID_RE.test(v)) return v;
  if (v) localStorage.removeItem(key);
  return null;
};

export function ActiveContextProvider({ children }: { children: ReactNode }) {
  const [brandId, setBrandIdState] = useState<string | null>(null);
  const [clientId, setClientIdState] = useState<string | null>(null);
  // Espelho síncrono do workspace ativo: `setBrandId` precisa saber se houve
  // troca real de workspace sem depender do estado já ter re-renderizado.
  const brandRef = useRef<string | null>(null);

  // Hidratação: `localStorage` é apenas preferência persistida. Só marcamos o
  // workspace como "resolvido" quando existe um valor; caso contrário o
  // contexto continua indefinido até o switcher resolver a lista real.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const persisted = readUuid(BRAND_KEY);
    brandRef.current = persisted;
    setBrandIdState(persisted);
    setClientIdState(readUuid(CLIENT_KEY));
    if (persisted) publishActiveWorkspace(persisted, true);
  }, []);


  /**
   * Transição de identidade (`resetIdentityState`): o estado local é limpo e o
   * workspace volta a ser indefinido — o contexto é reconstruído a partir dos
   * workspaces reais do usuário atual, sem herdar o anterior.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onReset = () => {
      brandRef.current = null;
      setBrandIdState(null);
      setClientIdState(null);
      markActiveWorkspaceUnresolved();
    };
    window.addEventListener("nx:identity-reset", onReset);
    return () => window.removeEventListener("nx:identity-reset", onReset);
  }, []);

  const setBrandId = useCallback((id: string | null) => {
    // Reafirmar o MESMO workspace (revalidação no boot) não pode derrubar o
    // cliente ativo — só a troca real de workspace limpa o cliente, porque ele
    // pertence ao workspace anterior. A validação de pertencimento/escopo
    // continua sendo feita contra a lista real de clientes (switcher/servidor).
    const changed = shouldClearClientOnBrandChange(brandRef.current, id);
    brandRef.current = id;
    setBrandIdState(id);
    // Contexto canônico primeiro; persistência é auxiliar.
    publishActiveWorkspace(id, true);
    if (typeof window === "undefined") return;
    if (id) localStorage.setItem(BRAND_KEY, id);
    else localStorage.removeItem(BRAND_KEY);
    if (!changed) return;
    setClientIdState(null);
    localStorage.removeItem(CLIENT_KEY);
  }, []);

  const setClientId = useCallback((id: string | null) => {
    setClientIdState(id);
    if (typeof window === "undefined") return;
    if (id) localStorage.setItem(CLIENT_KEY, id);
    else localStorage.removeItem(CLIENT_KEY);
  }, []);

  const value = useMemo(
    () => ({ brandId, clientId, setBrandId, setClientId }),
    [brandId, clientId, setBrandId, setClientId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveContext(): ActiveContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveContext requires <ActiveContextProvider>");
  return v;
}

/** Safe variant: returns null ids when provider is missing (public routes). */
export function useActiveContextOptional(): ActiveContextValue {
  const v = useContext(Ctx);
  if (!v) return { brandId: null, clientId: null, setBrandId: () => {}, setClientId: () => {} };
  return v;
}

/**
 * `true` quando o workspace ativo já terminou de resolver (existe ou não
 * existe). Telas usam isso para distinguir "ainda carregando o contexto" de
 * "usuário sem workspace" — sem isso o dashboard mostrava o estado vazio
 * durante a hidratação.
 */
export function useWorkspaceResolved(): boolean {
  return useSyncExternalStore(
    subscribeActiveWorkspace,
    () => getActiveWorkspace().resolved,
    () => false,
  );
}

/**
 * Estado explícito do contexto: `resolving` | `ready` | `empty` | `error`.
 * Telas usam isso para nunca ficar presas em skeleton — cada estado tem um
 * desenho final (skeleton com retry, vazio ou erro com retry).
 */
export function useWorkspaceStatus(): WorkspaceStatus {
  return useSyncExternalStore(
    subscribeActiveWorkspace,
    () => getActiveWorkspace().status,
    () => "resolving" as WorkspaceStatus,
  );
}


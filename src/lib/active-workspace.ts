/**
 * Fonte canônica (não-React) do workspace ativo.
 *
 * O `ActiveContextProvider` continua sendo a autoridade do contexto: ele
 * publica aqui todo valor que resolve. Código que roda fora da árvore React
 * (ex.: `beforeLoad` das rotas / feature gate) lê deste registro em vez de ler
 * `localStorage`, que é apenas persistência auxiliar de preferência.
 *
 * `resolved` distingue "ainda não sabemos qual é o workspace" de "não existe
 * workspace" — sem isso, o gate classifica inicialização como bloqueio.
 */
/**
 * Estados terminais explícitos — sem isso a UI não conseguia distinguir
 * "ainda resolvendo" de "sem workspace" de "falha ao resolver", e qualquer
 * falha virava skeleton infinito.
 */
export type WorkspaceStatus = "resolving" | "ready" | "empty" | "error";

export type ActiveWorkspaceState = {
  brandId: string | null;
  /** true quando o contexto já terminou de resolver o workspace ativo. */
  resolved: boolean;
  status: WorkspaceStatus;
};

const INITIAL: ActiveWorkspaceState = { brandId: null, resolved: false, status: "resolving" };

let state: ActiveWorkspaceState = INITIAL;
const listeners = new Set<(s: ActiveWorkspaceState) => void>();

function emit(): void {
  for (const fn of [...listeners]) fn(state);
}

export function getActiveWorkspace(): ActiveWorkspaceState {
  return state;
}

/** Publicado pelo contexto React quando o workspace ativo é resolvido. */
export function publishActiveWorkspace(brandId: string | null, resolved = true): void {
  const status: WorkspaceStatus = !resolved ? "resolving" : brandId ? "ready" : "empty";
  if (state.brandId === brandId && state.resolved === resolved && state.status === status) return;
  state = { brandId, resolved, status };
  emit();
}

/**
 * Falha ao resolver o workspace (lista de workspaces indisponível). É estado
 * TERMINAL: a tela mostra erro com retry em vez de ficar em skeleton, e o
 * feature gate não fica preso aguardando resolução.
 */
export function publishActiveWorkspaceError(): void {
  if (state.status === "error") return;
  state = { brandId: null, resolved: true, status: "error" };
  emit();
}

/** Transição de identidade: o workspace volta a ser "indefinido". */
export function markActiveWorkspaceUnresolved(): void {
  state = INITIAL;
  emit();
}

export function subscribeActiveWorkspace(fn: (s: ActiveWorkspaceState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}


/**
 * Aguarda a resolução do workspace (evita a race em que o gate roda antes do
 * contexto carregar e conclui "sem workspace"). Nunca prende a navegação: após
 * o timeout devolve o estado atual como está.
 */
export function waitForActiveWorkspace(timeoutMs = 3_000): Promise<ActiveWorkspaceState> {
  if (state.resolved) return Promise.resolve(state);
  return new Promise((resolve) => {
    let done = false;
    const finish = (s: ActiveWorkspaceState) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(s);
    };
    const unsub = subscribeActiveWorkspace((s) => {
      if (s.resolved) finish(s);
    });
    const timer = setTimeout(() => finish(state), timeoutMs);
  });
}

/**
 * Preferência persistida de workspace (apenas dica de inicialização).
 *
 * Em carregamento direto de uma rota protegida, o `beforeLoad` roda ANTES do
 * `ActiveContextProvider` montar — nesse instante o registro canônico ainda
 * está "não resolvido". A dica permite consultar o entitlement do workspace
 * provável sem esperar o timeout inteiro. Não concede autorização: o servidor
 * (RLS/guards) segue sendo a autoridade de cada leitura/escrita.
 */
export function getPersistedWorkspaceHint(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("nx.brand") || null;
  } catch {
    return null;
  }
}

/** Apenas para testes. */
export function __resetActiveWorkspace(): void {
  state = INITIAL;
  listeners.clear();
}

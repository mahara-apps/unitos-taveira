import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type PageHeaderState = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
};

type Ctx = {
  state: PageHeaderState;
  set: (s: PageHeaderState) => void;
  clear: () => void;
};

const PageHeaderCtx = createContext<Ctx | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageHeaderState>({});
  const value = useMemo<Ctx>(
    () => ({
      state,
      set: (s) => setState(s),
      clear: () => setState({}),
    }),
    [state],
  );
  return <PageHeaderCtx.Provider value={value}>{children}</PageHeaderCtx.Provider>;
}

export function usePageHeaderState(): PageHeaderState {
  const c = useContext(PageHeaderCtx);
  return c?.state ?? {};
}

/**
 * Register a page's title / subtitle / action buttons in the app shell header.
 * Any node is fine for `actions`; primary CTAs should live there instead of
 * being duplicated inside the page body.
 */
export function usePageHeader(input: PageHeaderState, deps: ReadonlyArray<unknown> = []) {
  const c = useContext(PageHeaderCtx);
  useEffect(() => {
    c?.set(input);
    return () => c?.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

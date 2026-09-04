import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useActiveContextOptional } from "./use-active-context";
import { supabase } from "@/integrations/supabase/client";
import { amISuperAdmin, listBrandFeatures } from "@/lib/feature-flags.functions";

/** Só chamamos server fns autenticadas quando existe sessão no browser. */
function useHasSession(): boolean {
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setHasSession(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return hasSession;
}


export function useBrandFeatures() {
  const { brandId } = useActiveContextOptional();
  const hasSession = useHasSession();
  const list = useServerFn(listBrandFeatures);
  return useQuery({
    queryKey: ["brand-features", brandId],
    queryFn: () => list({ data: { brandId: brandId! } }),
    enabled: !!brandId && hasSession,
    staleTime: 60_000,
  });
}

/**
 * Hook cosmético — decide se um item de UI deve aparecer. O bloqueio real
 * fica no `beforeLoad` das rotas (ver `feature-flags.gate.ts`).
 * Enquanto carrega, assume habilitado para evitar flicker.
 */
export function useFeatureAccess(featureKey: string): { enabled: boolean; loading: boolean } {
  const q = useBrandFeatures();
  if (q.isLoading || !q.data) return { enabled: true, loading: true };
  const f = q.data.find((r) => r.key === featureKey);
  if (!f) return { enabled: true, loading: false };
  return { enabled: f.enabled, loading: false };
}

export function useIsSuperAdmin() {
  const hasSession = useHasSession();
  const fn = useServerFn(amISuperAdmin);
  return useQuery({
    queryKey: ["me-is-super-admin"],
    queryFn: () => fn(),
    enabled: hasSession,
    retry: false,
    staleTime: 5 * 60_000,
  });

}

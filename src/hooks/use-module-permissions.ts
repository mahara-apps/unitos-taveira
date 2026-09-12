import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useActiveContext } from "@/hooks/use-active-context";
import { getCachedUser } from "@/lib/auth-cache";
import { supabase } from "@/integrations/supabase/client";
import { callRpc } from "@/lib/supabase-rpc";
import {
  can,
  emptyModulePermissions,
  mergeModulePermissions,
  normalizeModulePermissions,
  type ModuleAction,
  type ModuleKey,
  type ModulePermissions,
} from "@/lib/module-permissions";

type Result = {
  permissions: ModulePermissions;
  can: (moduleKey: ModuleKey, action?: ModuleAction) => boolean;
  isReady: boolean;
};

/**
 * Permissões efetivas por módulo do usuário logado no workspace ativo.
 * Gating de UI apenas — a autorização real fica na RLS e nas server functions.
 */
export function useModulePermissions(): Result {
  const { brandId } = useActiveContext();

  const q = useQuery({
    queryKey: ["my-module-permissions", brandId],
    queryFn: async () => {
      const user = await getCachedUser();
      if (!user || !brandId) return null;
      const { data, error } = await callRpc(supabase, "effective_module_permissions", {
        _user_id: user.id,
        _brand_id: brandId,
      });
      if (error) throw error;
      return { permissions: normalizeModulePermissions(data) };
    },
    enabled: !!brandId,
    staleTime: 60_000,
    retry: 1,
    retryDelay: 1_000,
  });

  return useMemo<Result>(() => {
    const permissions = q.data?.permissions
      ? mergeModulePermissions(q.data.permissions, null)
      : emptyModulePermissions();
    return {
      permissions,
      can: (moduleKey, action = "view") => can(permissions, moduleKey, action),
      isReady: !q.isLoading,
    };
  }, [q.data, q.isLoading]);
}

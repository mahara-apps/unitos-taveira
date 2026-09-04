import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { myModulePermissions } from "@/lib/access-profiles.functions";
import { useActiveContext } from "@/hooks/use-active-context";
import { getCachedUser } from "@/lib/auth-cache";
import {
  can,
  emptyModulePermissions,
  mergeModulePermissions,
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
  const load = useServerFn(myModulePermissions);

  const q = useQuery({
    queryKey: ["my-module-permissions", brandId],
    queryFn: async () => {
      const user = await getCachedUser();
      if (!user || !brandId) return null;
      return load({ data: { brandId } });
    },
    enabled: !!brandId,
    staleTime: 60_000,
    retry: false,
  });

  return useMemo<Result>(() => {
    const permissions = q.data?.permissions
      ? mergeModulePermissions(q.data.permissions, null)
      : emptyModulePermissions();
    return {
      permissions,
      can: (moduleKey, action = "view") => can(permissions, moduleKey, action),
      isReady: !q.isLoading && q.data !== undefined,
    };
  }, [q.data, q.isLoading]);
}

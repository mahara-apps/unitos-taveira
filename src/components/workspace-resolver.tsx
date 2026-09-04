import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveContext } from "@/hooks/use-active-context";
import { useMyBrandsQuery } from "@/hooks/use-my-brands";
import { publishActiveWorkspace, publishActiveWorkspaceError } from "@/lib/active-workspace";

/** Watchdog: nenhum boot pode ficar "resolvendo" indefinidamente. */
const RESOLVE_TIMEOUT_MS = 15_000;

/**
 * Resolvedor de workspace ativo — montado sempre dentro de `_authenticated`,
 * independente de qualquer UI.
 *
 * Antes essa resolução vivia dentro do seletor da sidebar: se aquela query
 * falhasse (ex.: 401 transitório logo após o login) ou o componente não
 * estivesse montado, o contexto nunca era publicado e o Dashboard ficava em
 * skeleton até uma navegação forçar novo fetch.
 *
 * O valor persistido é apenas PREFERÊNCIA: se não estiver na lista real de
 * workspaces do usuário atual, é descartado. Nenhum cliente é selecionado
 * automaticamente.
 */
export function WorkspaceResolver() {
  const { brandId, setBrandId } = useActiveContext();
  const q = useMyBrandsQuery();

  useEffect(() => {
    if (q.isError) {
      // Com um workspace já resolvido (preferência válida), a falha da lista
      // não derruba o contexto — a tela continua funcional.
      if (!brandId) publishActiveWorkspaceError();
      return;
    }
    const brands = q.data;
    if (!brands) return;
    if (brandId && !brands.some((b) => b.id === brandId)) {
      setBrandId(brands.length > 0 ? brands[0]!.id : null);
      return;
    }
    if (!brandId && brands.length > 0) {
      setBrandId(brands[0]!.id);
      return;
    }
    // Estado terminal: com workspace (ready) ou sem nenhum (empty).
    publishActiveWorkspace(brandId, true);
  }, [brandId, q.data, q.isError, setBrandId]);

  // Se nada resolveu no tempo limite, o estado vira erro com retry — nunca
  // skeleton eterno.
  useEffect(() => {
    if (q.data || q.isError || brandId) return;
    const t = setTimeout(() => {
      if (!brandId) publishActiveWorkspaceError();
    }, RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [q.data, q.isError, brandId]);

  return null;
}

/** Retry manual da resolução do workspace (usado pelos estados de erro). */
export function useRetryWorkspace(): () => void {
  const qc = useQueryClient();
  return () => {
    publishActiveWorkspace(null, false);
    void qc.invalidateQueries({ queryKey: ["brands"] });
  };
}

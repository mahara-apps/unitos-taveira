import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyBrands } from "@/lib/workspace.functions";
import { useSessionUser } from "@/hooks/use-session-user";

export type MyBrand = Awaited<ReturnType<typeof listMyBrands>>[number];

/**
 * Fonte única da lista de workspaces do usuário.
 *
 * Compartilhada pelo resolvedor de contexto e pelo seletor da sidebar: se cada
 * um tivesse sua própria query, o contexto podia ficar "resolvendo" para
 * sempre enquanto a UI já tinha os dados.
 *
 * `retry` mais alto de propósito: logo após o login o token pode ainda não
 * estar anexado à server function, e a primeira chamada falha de forma
 * transitória — sem retry esse 401 congelava o boot até uma navegação.
 */
export function useMyBrandsQuery(): UseQueryResult<MyBrand[], Error> {
  const list = useServerFn(listMyBrands);
  const { userId } = useSessionUser();
  return useQuery({
    queryKey: ["brands"],
    queryFn: () => list(),
    // Sem sessão resolvida a server function é chamada sem bearer e o
    // middleware lança "Unauthorized: No authorization header provided".
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 3_000),
  });
}

import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { resolvePortalTokenFn } from "@/lib/portal-public.functions";
import { FullScreenLoader, PortalAccessError } from "@/components/portal/portal-shared";
import { PortalModeProvider } from "@/components/portal/portal-context";
import { PortalShell } from "@/components/portal/portal-shell";
import { activePortalTab } from "@/components/portal/portal-nav";

/**
 * Portal por link (token) — mesma casca do portal por login (`PortalShell`) e a
 * mesma navegação única. A identidade das decisões é resolvida no servidor.
 */
export const Route = createFileRoute("/portal/$token")({
  component: PortalShellRoute,
  head: () => ({
    meta: [{ title: "Portal do cliente" }, { name: "robots", content: "noindex" }],
  }),
});

function PortalShellRoute() {
  const { token } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const resolve = useServerFn(resolvePortalTokenFn);
  const sessionQ = useQuery({
    queryKey: ["portal", "session", token],
    queryFn: () => resolve({ data: { token } }),
    retry: 1,
    staleTime: 5 * 60_000,
  });
  const activeTab = activePortalTab(pathname, `/portal/${token}`);

  if (sessionQ.isLoading) return <FullScreenLoader />;
  if (sessionQ.isError)
    return (
      <PortalAccessError
        mode="token"
        message={(sessionQ.error as Error)?.message}
        onRetry={() => void sessionQ.refetch()}
      />
    );
  if (!sessionQ.data?.client)
    return <PortalAccessError mode="token" message={sessionQ.data?.error} />;

  const client = sessionQ.data.client;
  const brand = sessionQ.data.brand;
  const theme = sessionQ.data.theme;
  const accent = theme?.accent || client.color || "var(--primary)";

  return (
    <PortalModeProvider value={{ kind: "token", token }}>
      <PortalShell
        clientName={client.name}
        activeTab={activeTab}
        accent={accent}
        dark={theme?.dark}
        logoUrl={theme?.logoUrl ?? null}
        background={theme?.bg ?? null}
        footerLabel={
          theme?.showAgencyCredit === false
            ? (theme?.footerLabel ?? "")
            : (theme?.footerLabel ?? (brand?.name ? `por ${brand.name}` : ""))
        }
      >
        <Outlet />
      </PortalShell>
    </PortalModeProvider>
  );
}

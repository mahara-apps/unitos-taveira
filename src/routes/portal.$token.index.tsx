import { createFileRoute } from "@tanstack/react-router";
import { HomeTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/portal/$token/")({
  head: () => ({
    meta: [
      { title: "Início | Portal do cliente" },
      { name: "description", content: "Acompanhe aprovações, pauta e publicações da sua marca." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Início" },
      {
        property: "og:description",
        content: "Acompanhe aprovações, pauta e publicações da sua marca.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortalHomeRoute,
});

function PortalHomeRoute() {
  return <HomeTab />;
}

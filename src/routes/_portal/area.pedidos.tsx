import { createFileRoute } from "@tanstack/react-router";
import { PortalRequests } from "@/components/portal/portal-requests";

export const Route = createFileRoute("/_portal/area/pedidos")({
  head: () => ({
    meta: [
      { title: "Pedidos | Portal do cliente" },
      {
        name: "description",
        content: "Abra novos pedidos para a equipe e acompanhe cada solicitação.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Pedidos" },
      {
        property: "og:description",
        content: "Abra novos pedidos para a equipe e acompanhe cada solicitação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <PortalRequests />,
});

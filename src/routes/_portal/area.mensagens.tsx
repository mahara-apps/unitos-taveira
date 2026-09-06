import { createFileRoute } from "@tanstack/react-router";
import { PortalMessages } from "@/components/portal/portal-messages";

export const Route = createFileRoute("/_portal/area/mensagens")({
  head: () => ({
    meta: [
      { title: "Mensagens | Portal do cliente" },
      {
        name: "description",
        content: "Converse com a equipe e acompanhe todo o histórico da sua marca.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Mensagens" },
      {
        property: "og:description",
        content: "Converse com a equipe e acompanhe todo o histórico da sua marca.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <PortalMessages />,
});

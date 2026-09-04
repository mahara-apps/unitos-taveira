import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/_portal/area/aprovacoes")({
  head: () => ({
    meta: [
      { title: "Aprovações | Portal do cliente" },
      {
        name: "description",
        content: "Aprove a pauta do mês e os conteúdos da sua marca em um único fluxo.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Aprovações" },
      {
        property: "og:description",
        content: "Aprove a pauta do mês e os conteúdos da sua marca em um único fluxo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ApprovalsTab />,
});

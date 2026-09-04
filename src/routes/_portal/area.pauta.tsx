import { createFileRoute } from "@tanstack/react-router";
import { PautaTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/_portal/area/pauta")({
  head: () => ({
    meta: [
      { title: "Pauta | Portal do cliente" },
      { name: "description", content: "Veja e aprove a pauta do mês da sua marca." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Pauta" },
      { property: "og:description", content: "Veja e aprove a pauta do mês da sua marca." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <PautaTab />,
});

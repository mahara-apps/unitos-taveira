import { createFileRoute } from "@tanstack/react-router";
import { PautaTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/portal/$token/pauta")({
  head: () => ({
    meta: [
      { title: "Pauta | Portal do cliente" },
      { name: "description", content: "Revise e aprove a pauta de conteúdos do mês." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Pauta" },
      { property: "og:description", content: "Revise e aprove a pauta de conteúdos do mês." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <PautaTab />,
});

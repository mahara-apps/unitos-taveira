import { createFileRoute } from "@tanstack/react-router";
import { HomeTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/_portal/area/inicio")({
  head: () => ({
    meta: [
      { title: "Área do cliente | Portal" },
      {
        name: "description",
        content: "Acompanhe aprovações, pauta, calendário e arquivos da sua marca.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Área do cliente" },
      {
        property: "og:description",
        content: "Acompanhe aprovações, pauta, calendário e arquivos da sua marca.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <HomeTab />,
});

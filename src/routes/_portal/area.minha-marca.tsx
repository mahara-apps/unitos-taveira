import { createFileRoute } from "@tanstack/react-router";
import { BrandTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/_portal/area/minha-marca")({
  head: () => ({
    meta: [
      { title: "Minha Marca | Portal do cliente" },
      {
        name: "description",
        content: "Consulte as informações da sua marca registradas pela equipe.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Minha Marca" },
      {
        property: "og:description",
        content: "Consulte as informações da sua marca registradas pela equipe.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <BrandTab />,
});

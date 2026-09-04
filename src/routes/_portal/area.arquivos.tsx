import { createFileRoute } from "@tanstack/react-router";
import { FilesTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/_portal/area/arquivos")({
  head: () => ({
    meta: [
      { title: "Arquivos | Portal do cliente" },
      {
        name: "description",
        content: "Baixe documentos e materiais compartilhados pela equipe da agência.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Arquivos" },
      {
        property: "og:description",
        content: "Baixe documentos e materiais compartilhados pela equipe da agência.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <FilesTab />,
});

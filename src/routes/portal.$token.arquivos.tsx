import { createFileRoute } from "@tanstack/react-router";
import { FilesTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/portal/$token/arquivos")({
  head: () => ({
    meta: [
      { title: "Arquivos | Portal do cliente" },
      { name: "description", content: "Baixe documentos e materiais compartilhados pela equipe." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Arquivos" },
      {
        property: "og:description",
        content: "Baixe documentos e materiais compartilhados pela equipe.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortalFilesRoute,
});

function PortalFilesRoute() {
  return <FilesTab />;
}

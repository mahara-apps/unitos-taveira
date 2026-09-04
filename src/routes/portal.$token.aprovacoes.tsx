import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/portal/$token/aprovacoes")({
  head: () => ({
    meta: [
      { title: "Aprovações | Portal do cliente" },
      { name: "description", content: "Aprove ou peça ajustes nos conteúdos da sua marca." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Aprovações" },
      { property: "og:description", content: "Aprove ou peça ajustes nos conteúdos da sua marca." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortalApprovalsRoute,
});

function PortalApprovalsRoute() {
  return <ApprovalsTab />;
}

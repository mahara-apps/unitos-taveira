import { createFileRoute } from "@tanstack/react-router";
import { PortalAccount } from "@/components/portal/portal-account";

export const Route = createFileRoute("/_portal/area/conta")({
  head: () => ({
    meta: [
      { title: "Minha conta | Portal do cliente" },
      {
        name: "description",
        content: "Atualize seu nome, foto, e-mail, senha e preferências de aviso.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Minha conta" },
      {
        property: "og:description",
        content: "Atualize seu nome, foto, e-mail, senha e preferências de aviso.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <PortalAccount />,
});

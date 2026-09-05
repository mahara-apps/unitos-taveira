import { createFileRoute } from "@tanstack/react-router";
import { PortalNotifications } from "@/components/portal/portal-notifications";

export const Route = createFileRoute("/_portal/area/avisos")({
  head: () => ({
    meta: [
      { title: "Avisos | Portal do cliente" },
      {
        name: "description",
        content: "Veja aprovações pendentes, prazos e respostas da equipe em um só lugar.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Avisos" },
      {
        property: "og:description",
        content: "Veja aprovações pendentes, prazos e respostas da equipe em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <PortalNotifications />,
});

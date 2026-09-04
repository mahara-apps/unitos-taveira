import { createFileRoute } from "@tanstack/react-router";
import { BriefingTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/portal/$token/briefing")({
  head: () => ({
    meta: [
      { title: "Briefing | Portal do cliente" },
      {
        name: "description",
        content: "Responda as informações que a equipe pediu sobre sua marca.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Briefing" },
      {
        property: "og:description",
        content: "Responda as informações que a equipe pediu sobre sua marca.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortalBriefingRoute,
});

function PortalBriefingRoute() {
  return <BriefingTab />;
}

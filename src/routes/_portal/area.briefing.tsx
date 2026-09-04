import { createFileRoute } from "@tanstack/react-router";
import { BriefingTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/_portal/area/briefing")({
  head: () => ({
    meta: [
      { title: "Briefing | Portal do cliente" },
      {
        name: "description",
        content: "Responda os briefings pendentes solicitados pela equipe da agência.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Briefing" },
      {
        property: "og:description",
        content: "Responda os briefings pendentes solicitados pela equipe da agência.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <BriefingTab />,
});

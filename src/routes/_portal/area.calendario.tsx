import { createFileRoute } from "@tanstack/react-router";
import { CalendarTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/_portal/area/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário | Portal do cliente" },
      {
        name: "description",
        content: "Veja o calendário de publicações aprovadas e agendadas da sua marca.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Calendário" },
      {
        property: "og:description",
        content: "Veja o calendário de publicações aprovadas e agendadas da sua marca.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <CalendarTab />,
});

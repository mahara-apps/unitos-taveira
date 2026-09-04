import { createFileRoute } from "@tanstack/react-router";
import { CalendarTab } from "@/components/portal/portal-tabs";

export const Route = createFileRoute("/portal/$token/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário | Portal do cliente" },
      { name: "description", content: "Veja o que está agendado e o que já foi publicado." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Calendário" },
      { property: "og:description", content: "Veja o que está agendado e o que já foi publicado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortalCalendarRoute,
});

function PortalCalendarRoute() {
  return <CalendarTab />;
}

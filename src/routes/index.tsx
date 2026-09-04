import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Unitos — Operação e aprovação de conteúdo para agências" },
      {
        name: "description",
        content:
          "Unitos centraliza briefing, pauta, produção, aprovação do cliente e publicação em um único fluxo para agências.",
      },
      { property: "og:title", content: "Unitos — Operação de conteúdo para agências" },
      {
        property: "og:description",
        content: "Briefing, pauta, produção, aprovação e publicação em um único fluxo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
});

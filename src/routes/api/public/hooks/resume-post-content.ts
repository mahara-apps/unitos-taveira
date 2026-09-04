import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { assertCronRequest } from "@/lib/cron-auth.server";

/**
 * Retoma a geração de conteúdo de peças pendentes (idea / copy_failed*) e
 * libera travas órfãs em `copy_running`. Endpoint de operação/cron: exige o
 * segredo `CRON_SECRET` no header `x-cron-secret`, igual aos demais hooks.
 */
const BodySchema = z.object({
  brandId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  /** Peças específicas — usado em operação para destravar/gerar itens pontuais. */
  postIds: z.array(z.string().uuid()).min(1).max(10).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export const Route = createFileRoute("/api/public/hooks/resume-post-content")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronDenied = assertCronRequest(request);
        if (cronDenied) return cronDenied;

        let raw: unknown = {};
        try {
          raw = await request.json();
        } catch {
          raw = {};
        }
        const parsed = BodySchema.safeParse(raw ?? {});
        if (!parsed.success) {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }

        if (parsed.data.postIds?.length) {
          const { generatePostsContentSequential } = await import("@/lib/post-agents.server");
          const result = await generatePostsContentSequential(parsed.data.postIds, {
            userId: null,
          });
          return Response.json({ candidates: parsed.data.postIds.length, ...result });
        }

        const { resumePendingPostContent } = await import("@/lib/post-agents.server");
        const result = await resumePendingPostContent({
          brandId: parsed.data.brandId ?? null,
          clientId: parsed.data.clientId ?? null,
          projectId: parsed.data.projectId ?? null,
          limit: parsed.data.limit ?? 3,
          userId: null,
        });
        return Response.json(result);
      },
    },
  },
});

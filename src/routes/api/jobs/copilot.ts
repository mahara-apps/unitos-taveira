import { createFileRoute } from "@tanstack/react-router";
import { guardClientScope } from "@/lib/http-scope.server";
import { waitUntil } from "@/lib/wait-until.server";
import { createClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { getBrandAiModelAdmin } from "@/lib/ai-provider.server";

const CHANNELS = ["instagram", "tiktok", "linkedin"] as const;
const CONTENT_TYPES = ["reel", "carousel", "image", "short_copy"] as const;

const BodySchema = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  pipelineId: z.string().uuid().nullable(),
  briefing: z.string().trim().min(4).max(4000),
  channels: z.array(z.enum(CHANNELS)).min(1).max(3),
  contentType: z.enum(CONTENT_TYPES),
  tone: z.string().trim().max(200).optional(),
  autoInject: z.boolean().default(true),
});

const TYPE_LABEL: Record<(typeof CONTENT_TYPES)[number], string> = {
  reel: "Reel Script (hook, beats, CTA)",
  carousel: "Carousel (5-8 slides, each with headline + body)",
  image: "Static Image Prompt (visual description + on-image copy + caption)",
  short_copy: "Short-form Caption Copy (hook + body + CTA)",
};

function buildUserClient(token: string) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function runCopilotJob(params: {
  jobId: string;
  token: string;
  userId: string;
  input: z.infer<typeof BodySchema>;
}) {
  const { jobId, token, userId, input } = params;
  const supabase = buildUserClient(token);

  const patch = (fields: Partial<Database["public"]["Tables"]["ai_jobs"]["Update"]>) =>
    supabase.from("ai_jobs").update(fields).eq("id", jobId);

  try {
    await patch({
      status: "running",
      started_at: new Date().toISOString(),
      progress: 10,
      step_label: "Reading brand context",
    });

    const [{ data: client }, { data: voice }] = await Promise.all([
      supabase
        .from("clients")
        .select("name, niche, tone_of_voice")
        .eq("id", input.clientId)
        .maybeSingle(),
      supabase
        .from("brand_voice_cards")
        .select("data")
        .eq("client_id", input.clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const brandCtx = [
      client?.name && `Account: ${client.name}`,
      client?.niche && `Niche: ${client.niche}`,
      (input.tone || client?.tone_of_voice) &&
        `Tone of voice: ${input.tone || client?.tone_of_voice}`,
      voice?.data && `Voice card: ${JSON.stringify(voice.data).slice(0, 800)}`,
    ]
      .filter(Boolean)
      .join("\n");

    await patch({ progress: 35, step_label: "Drafting copy with AI" });

    const { model } = await getBrandAiModelAdmin(input.brandId, "text", "operational", {
      agent: "copilot.job",
      clientId: input.clientId ?? null,
    });

    const system = [
      "You are an elite social-media copywriter and brand strategist.",
      "Write in the same language as the user's briefing (detect it from the briefing text).",
      "Produce a single, ready-to-ship draft — no meta commentary, no options list.",
      "Return STRICT JSON only, no markdown fences, matching:",
      `{"title": string, "content": string (markdown), "hashtags": string[] }`,
      "The 'content' field is the deliverable itself in clean markdown.",
    ].join(" ");

    const userMsg = [
      `Deliverable type: ${TYPE_LABEL[input.contentType]}`,
      `Target channels: ${input.channels.join(", ")}`,
      brandCtx ? `\nBrand context:\n${brandCtx}` : "",
      `\nBriefing / objective:\n${input.briefing}`,
      "\nRules:",
      "- Title: <= 80 chars, punchy, no emojis at start.",
      "- Content: format for the deliverable type; keep it channel-appropriate.",
      "- Hashtags: 4 to 8, no leading # in the array items.",
    ].join("\n");

    const { text } = await generateText({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
    });

    const cleaned = text
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    let parsed: { title?: unknown; content?: unknown; hashtags?: unknown } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const s = cleaned.indexOf("{");
      const e = cleaned.lastIndexOf("}");
      if (s >= 0 && e > s) {
        try {
          parsed = JSON.parse(cleaned.slice(s, e + 1));
        } catch {
          /* noop */
        }
      }
    }
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 160)
        : input.briefing.split("\n")[0].slice(0, 120);
    const content =
      typeof parsed.content === "string" && parsed.content.trim() ? parsed.content.trim() : cleaned;
    const hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags
          .filter((h): h is string => typeof h === "string")
          .map((h) => h.replace(/^#+/, "").trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];

    let postId: string | null = null;
    let targetRoute: string | null = null;

    if (input.autoInject && input.pipelineId) {
      await patch({ progress: 80, step_label: "Injecting into pipeline" });
      const { data: firstStage } = await supabase
        .from("content_pipeline_stages")
        .select("id")
        .eq("pipeline_id", input.pipelineId)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!firstStage) throw new Error("Pipeline has no stages configured.");
      const { data: maxRow } = await supabase
        .from("posts")
        .select("position")
        .eq("stage_id", firstStage.id)
        .order("position", { ascending: false })
        .limit(1);
      const nextPos = ((maxRow?.[0]?.position ?? -1) as number) + 1024;
      const copy = hashtags.length
        ? `${content}\n\n${hashtags.map((h) => `#${h}`).join(" ")}`
        : content;
      const { data: post, error: pErr } = await supabase
        .from("posts")
        .insert({
          brand_id: input.brandId,
          client_id: input.clientId,
          pipeline_id: input.pipelineId,
          stage_id: firstStage.id,
          title,
          copy,
          channels: input.channels,
          stage: "idea",
          position: nextPos,
          created_by: userId,
        })
        .select("id")
        .single();
      if (pErr) throw pErr;
      postId = post.id;
      targetRoute = "/content";
    }

    await patch({
      status: "succeeded",
      progress: 100,
      step_label: null,
      finished_at: new Date().toISOString(),
      result: { title, content, hashtags, postId, injected: Boolean(postId) },
      target_route: targetRoute,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patch({
      status: "failed",
      error: message,
      finished_at: new Date().toISOString(),
      step_label: null,
    });
  }
}

export const Route = createFileRoute("/api/jobs/copilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        if (token.split(".").length !== 3) return new Response("Unauthorized", { status: 401 });

        const rawBody = await request.json().catch(() => null);
        const parse = BodySchema.safeParse(rawBody);
        if (!parse.success)
          return new Response(JSON.stringify(parse.error.format()), { status: 400 });
        const input = parse.data;

        const supabase = buildUserClient(token);
        const { data: claims } = await supabase.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (!userId) return new Response("Unauthorized", { status: 401 });

        // Fase 2: nunca confiar no `clientId` do corpo — valida escopo antes
        // de qualquer trabalho com configuração administrativa de IA.
        const denied = await guardClientScope(supabase, userId, input.clientId);
        if (denied) return denied;

        const title = input.briefing.split("\n")[0].slice(0, 80) || "AI Draft";
        const { data: job, error: jobErr } = await supabase
          .from("ai_jobs")
          .insert({
            brand_id: input.brandId,
            client_id: input.clientId,
            user_id: userId,
            kind: "copilot_draft",
            title,
            subtitle: `${input.contentType} · ${input.channels.join(", ")}`,
            status: "queued",
            progress: 0,
            input: input as unknown as Database["public"]["Tables"]["ai_jobs"]["Insert"]["input"],
          })
          .select("id")
          .single();
        if (jobErr || !job)
          return new Response(jobErr?.message ?? "Failed to enqueue", { status: 500 });

        // Run in background — do NOT await. Cloudflare Workers keep the handler
        // alive until the promise settles even after the response is sent.
        waitUntil(runCopilotJob({ jobId: job.id, token, userId, input }));

        return new Response(JSON.stringify({ jobId: job.id }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

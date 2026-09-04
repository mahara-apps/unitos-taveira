import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Structured brand-memory container persisted in clients.brand_hub jsonb. */
export type BrandHubData = {
  description?: string;
  audience?: string;
  pain_points?: string;
  demographics?: string;
  tone_tags?: string[];
  palette?: Array<{ label: string; hex: string }>;
  competitors?: BrandHubCompetitor[];
  // --- Briefing Workspace (extended, all optional) ---
  mission?: string;
  positioning?: string;
  values?: string;
  offer?: string;
  price_range?: string;
  differentials?: string;
  objections?: string;
  journey?: string;
  desires?: string;
  inspirations?: string[];
  hashtags?: string[];
  do_dont?: { do?: string; dont?: string };
  volumetry?: {
    instagram?: number;
    tiktok?: number;
    linkedin?: number;
    youtube?: number;
    facebook?: number;
    x?: number;
    threads?: number;
  };
  /** Base do volume informado: por semana (padrão) ou por mês. */
  volumetry_basis?: "weekly" | "monthly";
  /**
   * Volumetria por canal + FORMATO (fonte de verdade operacional).
   * Chaves de formato canônicas: feed | stories | reels | carrossel.
   * `volumetry[canal]` é mantido em sincronia como a SOMA deste breakdown.
   */
  volumetry_breakdown?: Record<string, Record<string, number>>;
  formats?: {
    instagram?: string[];
    tiktok?: string[];
    linkedin?: string[];
    youtube?: string[];
    facebook?: string[];
    x?: string[];
    threads?: string[];
  };
  goals?: string;
  tone_text?: string;
};

export type BrandHubCompetitor = {
  id: string;
  handle: string;
  platform: "instagram" | "tiktok" | "youtube" | "linkedin" | "x";
  notes?: string;
  added_at: string;
  last_scraped_at?: string;
  last_metrics?: BrandHubCompetitorMetrics | null;
  last_error?: string | null;
};

export type BrandHubCompetitorMetrics = {
  followers?: number;
  posts_count?: number;
  avg_likes?: number;
  avg_comments?: number;
  engagement_rate?: number;
  top_posts?: Array<{ url?: string; caption?: string; likes?: number; comments?: number }>;
  recurring_hooks?: string[];
};

const Scope = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export type BrandHubClient = {
  id: string;
  name: string;
  niche: string | null;
  color: string | null;
  logo_url: string | null;
  logo_secondary_url: string | null;
  favicon_url: string | null;
  tone_of_voice: string | null;
  brand_hub: BrandHubData;
  socials: Record<string, string | undefined> | null;
  contact_name: string | null;
  contact_email: string | null;
  updated_at: string | null;
};

export const getBrandHub = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.parse(i))
  .handler(async ({ data, context }): Promise<BrandHubClient> => {
    const { data: row, error } = await context.supabase
      .from("clients")
      .select(
        "id, name, niche, color, logo_url, logo_secondary_url, favicon_url, tone_of_voice, brand_hub, socials, contact_name, contact_email, updated_at" as never,
      )
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("client_not_found");
    const r = row as unknown as BrandHubClient & { brand_hub: BrandHubData | null };
    return { ...r, brand_hub: r.brand_hub ?? {} };
  });

const HubPatch = Scope.extend({
  patch: z
    .object({
      description: z.string().max(5000).optional(),
      audience: z.string().max(2000).optional(),
      pain_points: z.string().max(2000).optional(),
      demographics: z.string().max(1000).optional(),
      tone_tags: z.array(z.string().max(40)).max(20).optional(),
      palette: z
        .array(
          z.object({
            label: z.string().max(40),
            hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          }),
        )
        .max(24)
        .optional(),
      mission: z.string().max(2000).optional(),
      positioning: z.string().max(2000).optional(),
      values: z.string().max(2000).optional(),
      offer: z.string().max(3000).optional(),
      price_range: z.string().max(500).optional(),
      differentials: z.string().max(3000).optional(),
      objections: z.string().max(3000).optional(),
      journey: z.string().max(3000).optional(),
      desires: z.string().max(2000).optional(),
      inspirations: z.array(z.string().max(400)).max(30).optional(),
      hashtags: z.array(z.string().max(80)).max(60).optional(),
      do_dont: z
        .object({ do: z.string().max(2000).optional(), dont: z.string().max(2000).optional() })
        .optional(),
      volumetry: z
        .object({
          instagram: z.number().int().min(0).max(200).optional(),
          tiktok: z.number().int().min(0).max(200).optional(),
          linkedin: z.number().int().min(0).max(200).optional(),
          youtube: z.number().int().min(0).max(200).optional(),
          facebook: z.number().int().min(0).max(200).optional(),
          x: z.number().int().min(0).max(200).optional(),
          threads: z.number().int().min(0).max(200).optional(),
        })
        .optional(),
      volumetry_basis: z.enum(["weekly", "monthly"]).optional(),
      /** canal → formato canônico → quantidade. */
      volumetry_breakdown: z
        .record(z.string().max(24), z.record(z.string().max(24), z.number().int().min(0).max(200)))
        .optional(),
      formats: z
        .object({
          instagram: z.array(z.string().max(24)).max(8).optional(),
          tiktok: z.array(z.string().max(24)).max(8).optional(),
          linkedin: z.array(z.string().max(24)).max(8).optional(),
          youtube: z.array(z.string().max(24)).max(8).optional(),
          facebook: z.array(z.string().max(24)).max(8).optional(),
          x: z.array(z.string().max(24)).max(8).optional(),
          threads: z.array(z.string().max(24)).max(8).optional(),
        })
        .optional(),
      goals: z.string().max(3000).optional(),
      tone_text: z.string().max(2000).optional(),
      competitors: z
        .array(
          z.object({
            id: z.string(),
            handle: z.string().max(120),
            platform: z.string().max(40).default("instagram"),
            added_at: z
              .string()
              .optional()
              .default(() => new Date().toISOString()),
            notes: z.string().max(500).optional(),
            last_scraped_at: z.string().optional(),
            last_error: z.string().optional(),
            snapshot: z.unknown().optional(),
          }),
        )
        .max(30)
        .optional(),
    })
    .partial(),
});

export const updateBrandHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HubPatch.parse(i))
  .handler(async ({ data, context }) => {
    const { data: current } = await context.supabase
      .from("clients")
      .select("brand_hub" as never)
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    const prev = ((current as { brand_hub?: BrandHubData } | null)?.brand_hub ??
      {}) as BrandHubData;
    const next = { ...prev, ...data.patch } as BrandHubData;
    // Sincroniza volumetry (total por canal) com o breakdown por formato:
    // o total deixa de ser editável isoladamente quando há breakdown.
    if (data.patch.volumetry_breakdown) {
      const { normalizeVolumetryBreakdown, deriveVolumetryTotals } =
        await import("@/lib/content-formats");
      const breakdown = normalizeVolumetryBreakdown(data.patch.volumetry_breakdown);
      next.volumetry_breakdown = breakdown as Record<string, Record<string, number>>;
      next.volumetry = deriveVolumetryTotals(
        breakdown,
        (next.volumetry ?? {}) as Record<string, number | undefined>,
      ) as BrandHubData["volumetry"];
    }
    // FASE 2: escrita canônica + snapshot em brand_briefing_versions.
    const { writeCanonicalBriefing } = await import("@/lib/briefing-write.server");
    const res = await writeCanonicalBriefing(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      patch: next as unknown as Record<string, unknown>,
      authorId: context.userId,
      origin: "manual",
      // Edição manual pode limpar campos: valores vazios devem persistir.
      skipEmpty: false,
    });
    return { ok: true, brand_hub: res.hub };
  });

/* -------------------- Competitor benchmarking -------------------- */

const HANDLE_RE = /^@?[A-Za-z0-9._-]{2,40}$/;

async function readHub(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  brandId: string,
  clientId: string,
): Promise<BrandHubData> {
  const { data, error } = await supabase
    .from("clients")
    .select("brand_hub" as never)
    .eq("id", clientId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("client_not_found");
  return ((data as { brand_hub?: BrandHubData }).brand_hub ?? {}) as BrandHubData;
}

async function writeHub(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  brandId: string,
  clientId: string,
  next: BrandHubData,
) {
  const { error } = await supabase
    .from("clients")
    .update({ brand_hub: next } as never)
    .eq("id", clientId)
    .eq("brand_id", brandId);
  if (error) throw error;
}

export const addCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Scope.extend({
      handle: z.string().trim().min(2).max(40).regex(HANDLE_RE, "invalid_handle"),
      platform: z.enum(["instagram", "tiktok", "youtube", "linkedin", "x"]).default("instagram"),
      notes: z.string().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const hub = await readHub(context.supabase, data.brandId, data.clientId);
    const list = [...(hub.competitors ?? [])];
    const clean = data.handle.replace(/^@/, "").toLowerCase();
    if (list.some((c) => c.handle.toLowerCase() === clean && c.platform === data.platform)) {
      throw new Error("competitor_already_registered");
    }
    if (list.length >= 30) throw new Error("competitor_limit_reached");
    const entry: BrandHubCompetitor = {
      id: crypto.randomUUID(),
      handle: clean,
      platform: data.platform,
      notes: data.notes,
      added_at: new Date().toISOString(),
      last_metrics: null,
    };
    list.push(entry);
    await writeHub(context.supabase, data.brandId, data.clientId, { ...hub, competitors: list });
    return { ok: true, competitor: entry };
  });

export const removeCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.extend({ competitorId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const hub = await readHub(context.supabase, data.brandId, data.clientId);
    const list = (hub.competitors ?? []).filter((c) => c.id !== data.competitorId);
    await writeHub(context.supabase, data.brandId, data.clientId, { ...hub, competitors: list });
    return { ok: true };
  });

/**
 * Scrapes a competitor via Apify (Instagram profile scraper).
 * Requires APIFY_TOKEN to be configured. If missing, returns a soft error
 * stored on the competitor so the UI surfaces the setup gap without failing.
 * Runs the actor synchronously with a short timeout — fine because the caller
 * enqueues it in the background job dock.
 */
export const scrapeCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.extend({ competitorId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const hub = await readHub(context.supabase, data.brandId, data.clientId);
    const list = [...(hub.competitors ?? [])];
    const idx = list.findIndex((c) => c.id === data.competitorId);
    if (idx < 0) throw new Error("competitor_not_found");
    const target = list[idx];

    const token = process.env.APIFY_TOKEN;
    const nowIso = new Date().toISOString();

    if (!token) {
      list[idx] = {
        ...target,
        last_scraped_at: nowIso,
        last_error:
          "APIFY_TOKEN not configured — add it in project secrets to enable live scraping.",
      };
      await writeHub(context.supabase, data.brandId, data.clientId, { ...hub, competitors: list });
      return { ok: false, reason: "no_token" as const, competitor: list[idx] };
    }

    // Instagram profile actor (public). We keep the actor id in one place so it
    // can be swapped without touching the UI. For other platforms we currently
    // no-op — future work.
    const actorId = "apify~instagram-profile-scraper";
    let metrics: BrandHubCompetitorMetrics | null = null;
    let errorMsg: string | null = null;

    try {
      if (target.platform !== "instagram") {
        throw new Error(`scraping_not_supported_for_${target.platform}`);
      }
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=90`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames: [target.handle], resultsLimit: 12 }),
        },
      );
      if (!runRes.ok) throw new Error(`Apify error [${runRes.status}]: ${await runRes.text()}`);
      const items = (await runRes.json()) as Array<Record<string, unknown>>;
      const profile = items[0] ?? {};
      const latestPosts = (profile.latestPosts as Array<Record<string, unknown>> | undefined) ?? [];
      const likes = latestPosts.map((p) => Number(p.likesCount ?? 0));
      const comments = latestPosts.map((p) => Number(p.commentsCount ?? 0));
      const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
      const followers = Number(profile.followersCount ?? 0);
      const avgLikes = avg(likes);
      const avgComments = avg(comments);
      metrics = {
        followers,
        posts_count: Number(profile.postsCount ?? latestPosts.length),
        avg_likes: Math.round(avgLikes),
        avg_comments: Math.round(avgComments),
        engagement_rate:
          followers > 0 ? Number(((avgLikes + avgComments) / followers).toFixed(4)) : 0,
        top_posts: latestPosts.slice(0, 5).map((p) => ({
          url: String(p.url ?? ""),
          caption: String(p.caption ?? "").slice(0, 280),
          likes: Number(p.likesCount ?? 0),
          comments: Number(p.commentsCount ?? 0),
        })),
        recurring_hooks: latestPosts
          .map((p) =>
            String(p.caption ?? "")
              .split(/[.\n!?]/)[0]
              ?.trim(),
          )
          .filter((s): s is string => Boolean(s && s.length > 5 && s.length < 140))
          .slice(0, 6),
      };
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    list[idx] = {
      ...target,
      last_scraped_at: nowIso,
      last_metrics: metrics,
      last_error: errorMsg,
    };
    await writeHub(context.supabase, data.brandId, data.clientId, { ...hub, competitors: list });
    return { ok: !errorMsg, competitor: list[idx] };
  });

const VisualsPatch = Scope.extend({
  patch: z
    .object({
      logo_url: z.string().url().nullable().optional(),
      logo_secondary_url: z.string().url().nullable().optional(),
      favicon_url: z.string().url().nullable().optional(),
    })
    .partial(),
});

export const updateBrandVisuals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => VisualsPatch.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clients")
      .update(data.patch as never)
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId);
    if (error) throw error;
    return { ok: true };
  });

/** Uploads an asset (logo/favicon) to the brand-assets bucket and returns a signed URL. */
const AssetUpload = Scope.extend({
  kind: z.enum(["logo", "logo_secondary", "favicon"]),
  filename: z.string().max(200),
  contentType: z.string().max(120),
  base64: z.string().min(1),
});

export const uploadBrandAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AssetUpload.parse(i))
  .handler(async ({ data, context }) => {
    const bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bin.byteLength > 5 * 1024 * 1024) throw new Error("asset_too_large");
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${data.brandId}/${data.clientId}/${data.kind}-${Date.now()}-${safeName}`;
    const { error } = await context.supabase.storage
      .from("brand-assets")
      .upload(path, bin, { contentType: data.contentType, upsert: true });
    if (error) throw error;
    const { data: signed, error: se } = await context.supabase.storage
      .from("brand-assets")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (se) throw se;
    const column =
      data.kind === "logo"
        ? "logo_url"
        : data.kind === "favicon"
          ? "favicon_url"
          : "logo_secondary_url";
    const { error: ue } = await context.supabase
      .from("clients")
      .update({ [column]: signed.signedUrl } as never)
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId);
    if (ue) throw ue;
    return { url: signed.signedUrl, path };
  });

/* -------------------- Documents (knowledge base) -------------------- */

export type ClientDocument = {
  id: string;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export const listClientDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.parse(i))
  .handler(async ({ data, context }): Promise<ClientDocument[]> => {
    const { data: rows, error } = await (
      context.supabase as never as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              eq: (
                k: string,
                v: string,
              ) => {
                order: (
                  c: string,
                  o: { ascending: boolean },
                ) => Promise<{ data: ClientDocument[] | null; error: unknown }>;
              };
            };
          };
        };
      }
    )
      .from("client_documents")
      .select("id, name, storage_path, mime_type, size_bytes, created_at")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });
    if (error) throw error as Error;
    return rows ?? [];
  });

const DocUpload = Scope.extend({
  filename: z.string().max(200),
  contentType: z.string().max(120),
  sizeBytes: z.number().int().nonnegative(),
  base64: z.string().min(1),
});

export const uploadClientDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DocUpload.parse(i))
  .handler(async ({ data, context }) => {
    if (data.sizeBytes > 25 * 1024 * 1024) throw new Error("document_too_large");
    const bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${data.brandId}/${data.clientId}/${Date.now()}-${safe}`;
    const { error: ue } = await context.supabase.storage
      .from("brand-documents")
      .upload(path, bin, { contentType: data.contentType, upsert: false });
    if (ue) throw ue;
    const { data: inserted, error } = await (
      context.supabase as never as {
        from: (t: string) => {
          insert: (v: Record<string, unknown>) => {
            select: (c: string) => {
              single: () => Promise<{ data: ClientDocument | null; error: unknown }>;
            };
          };
        };
      }
    )
      .from("client_documents")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        name: data.filename,
        storage_path: path,
        mime_type: data.contentType,
        size_bytes: data.sizeBytes,
        uploaded_by: context.userId,
      })
      .select("id, name, storage_path, mime_type, size_bytes, created_at")
      .single();
    if (error) throw error as Error;
    return inserted!;
  });

const DocDelete = Scope.extend({ documentId: z.string().uuid() });

export const deleteClientDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DocDelete.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error: qe } = await (
      context.supabase as never as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              eq: (
                k: string,
                v: string,
              ) => {
                eq: (
                  k: string,
                  v: string,
                ) => {
                  maybeSingle: () => Promise<{
                    data: { storage_path: string } | null;
                    error: unknown;
                  }>;
                };
              };
            };
          };
        };
      }
    )
      .from("client_documents")
      .select("storage_path")
      .eq("id", data.documentId)
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (qe) throw qe as Error;
    if (!row) throw new Error("document_not_found");
    await context.supabase.storage.from("brand-documents").remove([row.storage_path]);
    const { error } = await (
      context.supabase as never as {
        from: (t: string) => {
          delete: () => {
            eq: (
              k: string,
              v: string,
            ) => {
              eq: (k: string, v: string) => Promise<{ error: unknown }>;
            };
          };
        };
      }
    )
      .from("client_documents")
      .delete()
      .eq("id", data.documentId)
      .eq("brand_id", data.brandId);
    if (error) throw error as Error;
    return { ok: true };
  });

export const signClientDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.extend({ documentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await (
      context.supabase as never as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              eq: (
                k: string,
                v: string,
              ) => {
                eq: (
                  k: string,
                  v: string,
                ) => {
                  maybeSingle: () => Promise<{ data: { storage_path: string } | null }>;
                };
              };
            };
          };
        };
      }
    )
      .from("client_documents")
      .select("storage_path")
      .eq("id", data.documentId)
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!row) throw new Error("document_not_found");
    const { data: signed, error } = await context.supabase.storage
      .from("brand-documents")
      .createSignedUrl(row.storage_path, 60 * 5);
    if (error) throw error;
    return { url: signed.signedUrl };
  });

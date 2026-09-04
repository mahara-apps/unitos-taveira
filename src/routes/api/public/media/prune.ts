import { createFileRoute } from "@tanstack/react-router";
import { assertCronRequest } from "@/lib/cron-auth.server";

// Daily-cron endpoint: for posts published >30 days ago, delete original
// reference_media files from Storage and keep only the thumbnails.
export const Route = createFileRoute("/api/public/media/prune")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronDenied = assertCronRequest(request);
        if (cronDenied) return cronDenied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Find posts with published/archived state whose scheduled_at is
        // older than 30 days and that still have un-pruned reference_media.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const { data: posts, error } = await supabaseAdmin
          .from("posts")
          .select("id, reference_media, scheduled_at, stage")
          .lt("scheduled_at", cutoff)
          .not("reference_media", "is", null)
          .limit(500);

        if (error) {
          console.error("[prune] fetch error", error);
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let filesRemoved = 0;
        let postsTouched = 0;

        for (const post of posts ?? []) {
          const refs = Array.isArray(post.reference_media)
            ? (post.reference_media as Array<Record<string, unknown>>)
            : [];
          if (refs.length === 0) continue;

          const toRemove: string[] = [];
          const nextRefs = refs.map((r) => {
            const path = typeof r.path === "string" ? r.path : null;
            const thumb = typeof r.thumb_path === "string" ? r.thumb_path : null;
            const pruned = r.pruned === true;
            // Only prune originals that still exist AND we have a thumb
            // (never lose the last visual reference).
            if (!pruned && path && thumb) {
              toRemove.push(path);
              return { ...r, pruned: true };
            }
            return r;
          });

          if (toRemove.length === 0) continue;

          // Agrupa por bucket (legado `brand-assets` vs unificado `brand-media`).
          const bucketOf = (p: string): string => {
            const found = refs.find((r) => r?.path === p);
            return typeof found?.bucket === "string" ? (found.bucket as string) : "brand-assets";
          };
          const byBucket = new Map<string, string[]>();
          for (const p of toRemove) {
            const b = bucketOf(p);
            byBucket.set(b, [...(byBucket.get(b) ?? []), p]);
          }
          let rmErr: unknown = null;
          for (const [b, paths] of byBucket) {
            const { error } = await supabaseAdmin.storage.from(b).remove(paths);
            if (error) {
              rmErr = error;
              break;
            }
          }
          if (rmErr) {
            console.error("[prune] storage remove", post.id, rmErr);
            continue;
          }

          const { error: upErr } = await supabaseAdmin
            .from("posts")
            .update({ reference_media: nextRefs } as never)
            .eq("id", post.id);
          if (upErr) {
            console.error("[prune] update error", post.id, upErr);
            continue;
          }

          filesRemoved += toRemove.length;
          postsTouched += 1;
        }

        return Response.json({
          ok: true,
          posts_touched: postsTouched,
          files_removed: filesRemoved,
        });
      },
    },
  },
});

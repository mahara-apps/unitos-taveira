import { createFileRoute } from "@tanstack/react-router";
import { insertNotificationsDeduped } from "@/lib/notifications-dedupe";
import { assertCronRequest } from "@/lib/cron-auth.server";

/**
 * SLA overdue notifier.
 * Called by pg_cron once per hour. Autenticado pelo segredo dedicado
 * `CRON_SECRET` (header `x-cron-secret`) — nunca pela chave publicável.
 *
 * For each non-terminal stage with sla_days > 0, finds posts whose
 * (now - stage_entered_at) > sla_days and:
 *  - notifies the assignee (kind: sla_overdue)
 *  - notifies workspace owners/managers with an aggregated summary (kind: sla_overdue_manager)
 *
 * Dedupe: skip if a notification for the same (user_id, post_id, kind) already exists in the last 24h.
 */
export const Route = createFileRoute("/api/public/cron/sla-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronDenied = assertCronRequest(request);
        if (cronDenied) return cronDenied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1. Load stages with SLA
        const { data: stages, error: sErr } = await supabaseAdmin
          .from("content_pipeline_stages")
          .select("id,label,sla_days,sla_hours,is_terminal,pipeline_id")
          .eq("is_terminal", false);
        if (sErr) throw sErr;
        const stagesWithSla = (stages ?? [])
          .map((s) => {
            const h = (s.sla_hours as number | null) ?? null;
            const d = (s.sla_days as number | null) ?? null;
            const hours = h != null && h > 0 ? h : d != null && d > 0 ? d * 24 : null;
            return hours != null ? { ...s, _hours: hours } : null;
          })
          .filter(Boolean) as Array<{ id: string; label: string; _hours: number }>;
        if (stagesWithSla.length === 0) {
          return Response.json({ ok: true, scanned: 0, notified: 0 });
        }

        // 2. For each stage, find overdue posts
        const cutoffByStage = new Map<string, { label: string; sinceIso: string }>();
        for (const s of stagesWithSla) {
          const since = new Date(Date.now() - s._hours * 3_600_000).toISOString();
          cutoffByStage.set(s.id, { label: s.label, sinceIso: since });
        }

        const overdue: Array<{
          post_id: string;
          title: string;
          assignee_id: string | null;
          brand_id: string;
          client_id: string;
          stage_id: string;
          stage_label: string;
          hours_overdue: number;
          sla_hours: number;
        }> = [];

        for (const s of stagesWithSla) {
          const cutoff = cutoffByStage.get(s.id)!;
          const { data: rows, error: pErr } = await supabaseAdmin
            .from("posts")
            .select("id,title,assignee_id,brand_id,client_id,stage_id,stage_entered_at")
            .eq("stage_id", s.id)
            .is("deleted_at", null)
            .lt("stage_entered_at", cutoff.sinceIso);
          if (pErr) throw pErr;
          for (const r of rows ?? []) {
            const hoursIn =
              (Date.now() - new Date(r.stage_entered_at as string).getTime()) / 3_600_000;
            overdue.push({
              post_id: r.id as string,
              title: (r.title as string) ?? "Sem título",
              assignee_id: (r.assignee_id as string | null) ?? null,
              brand_id: r.brand_id as string,
              client_id: r.client_id as string,
              stage_id: r.stage_id as string,
              stage_label: cutoff.label,
              hours_overdue: Math.max(0, hoursIn - s._hours),
              sla_hours: s._hours,
            });
          }
        }

        if (overdue.length === 0) {
          return Response.json({ ok: true, scanned: 0, notified: 0 });
        }

        // 3. Notify assignees.
        // Idempotência: uma notificação por (user, post) ENQUANTO houver uma
        // pendente (não lida) — evita recriar o mesmo aviso a cada execução —
        // e no máximo uma por 24h depois de lida.
        const since24h = new Date(Date.now() - 86_400_000).toISOString();
        const withAssignee = overdue.filter((o) => o.assignee_id);

        let notifiedAssignees = 0;
        if (withAssignee.length > 0) {
          const userIds = Array.from(new Set(withAssignee.map((o) => o.assignee_id as string)));
          const { data: recent } = await supabaseAdmin
            .from("notifications")
            .select("user_id, dedupe_key, read_at, created_at")
            .eq("kind", "sla_overdue")
            .in("user_id", userIds)
            .or(`read_at.is.null,created_at.gte.${since24h}`);
          const seen = new Set(
            (recent ?? [])
              .map((r) => {
                const key = typeof r.dedupe_key === "string" ? r.dedupe_key : null;
                return key ? `${r.user_id}:${key}` : null;
              })
              .filter(Boolean) as string[],
          );
          const toInsert = withAssignee
            .filter((o) => !seen.has(`${o.assignee_id}:sla_overdue:${o.post_id}`))
            .map((o) => {
              const overdueLabel =
                o.hours_overdue >= 24
                  ? `${Math.floor(o.hours_overdue / 24)}d`
                  : `${Math.round(o.hours_overdue)}h`;
              const slaLabel =
                o.sla_hours >= 24 ? `${Math.round(o.sla_hours / 24)}d` : `${o.sla_hours}h`;
              return {
                user_id: o.assignee_id as string,
                brand_id: o.brand_id,
                kind: "sla_overdue" as const,
                title: `SLA vencido em "${o.stage_label}"`,
                body: `${o.title} • atrasado há ${overdueLabel} (SLA ${slaLabel})`,
                href: `/content?post=${o.post_id}`,
                dedupe_key: `sla_overdue:${o.post_id}`,
                payload: {
                  post_id: o.post_id,
                  stage_id: o.stage_id,
                  stage_label: o.stage_label,
                  hours_overdue: o.hours_overdue,
                  sla_hours: o.sla_hours,
                },
              };
            });
          notifiedAssignees = await insertNotificationsDeduped(
            supabaseAdmin as never,
            toInsert as never,
          );
        }

        // 4. Notify managers per brand (aggregated: one per manager per brand)
        const brandIds = Array.from(new Set(overdue.map((o) => o.brand_id)));
        const { data: managers } = await supabaseAdmin
          .from("brand_members")
          .select("user_id, brand_id, role")
          .in("brand_id", brandIds)
          .in("role", ["owner", "admin", "manager"]);

        // Dedupe: enquanto houver resumo pendente do workspace, não cria outro;
        // depois de lido, no máximo um por 24h.
        const { data: mgrRecent } = await supabaseAdmin
          .from("notifications")
          .select("user_id, dedupe_key, read_at, created_at")
          .eq("kind", "sla_overdue_manager")
          .or(`read_at.is.null,created_at.gte.${since24h}`);
        const mgrSeen = new Set(
          (mgrRecent ?? [])
            .map((r) => (typeof r.dedupe_key === "string" ? `${r.user_id}:${r.dedupe_key}` : null))
            .filter(Boolean) as string[],
        );

        const overdueByBrand = new Map<string, typeof overdue>();
        for (const o of overdue) {
          if (!overdueByBrand.has(o.brand_id)) overdueByBrand.set(o.brand_id, []);
          overdueByBrand.get(o.brand_id)!.push(o);
        }

        const mgrInserts: Array<{
          user_id: string;
          brand_id: string;
          kind: "sla_overdue_manager";
          title: string;
          body: string;
          href: string;
          dedupe_key: string;
          payload: Record<string, unknown>;
        }> = [];
        for (const m of managers ?? []) {
          const dedupeKey = `sla_overdue_manager:${m.brand_id as string}`;
          if (mgrSeen.has(`${m.user_id}:${dedupeKey}`)) continue;
          const list = overdueByBrand.get(m.brand_id as string) ?? [];
          if (list.length === 0) continue;
          mgrInserts.push({
            user_id: m.user_id as string,
            brand_id: m.brand_id as string,
            kind: "sla_overdue_manager",
            title: `${list.length} tarefa(s) atrasada(s) no workspace`,
            body: `${list
              .slice(0, 3)
              .map((l) => l.title)
              .join(", ")}${list.length > 3 ? "…" : ""}`,
            href: `/content?post=${list[0]?.post_id ?? ""}`,
            dedupe_key: dedupeKey,
            payload: {
              count: list.length,
              post_ids: list.map((l) => l.post_id).slice(0, 20),
            },
          });
        }

        const notifiedManagers = await insertNotificationsDeduped(
          supabaseAdmin as never,
          mgrInserts as never,
        );

        return Response.json({
          ok: true,
          scanned: overdue.length,
          notified_assignees: notifiedAssignees,
          notified_managers: notifiedManagers,
        });
      },
    },
  },
});

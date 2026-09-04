import { createFileRoute } from "@tanstack/react-router";

/**
 * Canal de progresso do provisionamento/validação de uma instalação.
 *
 * Chamado pelos scripts existentes (`supabase/install/bootstrap.sh`,
 * `supabase/install/validate.sh`) rodando NA INSTALAÇÃO DE DESTINO.
 *
 * Segurança:
 *  - existe somente na instalação MASTER (fora dela responde 404);
 *  - autenticado por token de execução de uso único, comparado por hash
 *    SHA-256 — o MASTER nunca guarda o token em claro;
 *  - token expira e é invalidado ao fechar a operação;
 *  - somente etapas conhecidas são aceitas e todo texto livre passa por
 *    redação de credenciais (`redactReportText`).
 */

export const Route = createFileRoute("/api/public/installations/report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { detectMaster } = await import("@/lib/installation/manager.server");
        if (!detectMaster()) return new Response("Not found", { status: 404 });

        const { parseReportEvent } = await import("@/lib/installation/report-contract");

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        const parsed = parseReportEvent(raw);
        if (!parsed.ok) return new Response(parsed.reason, { status: parsed.status });

        const { applyProgressReport, finalizeOperation, hashRunToken } =
          await import("@/lib/installation/runner.server");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tokenHash = await hashRunToken(parsed.event.token);

        const { data: op, error } = await supabaseAdmin
          .from("installation_operations")
          .select("*")
          .eq("run_token_hash", tokenHash)
          .in("status", ["pending", "running"])
          .maybeSingle();
        if (error) return new Response("Report failed", { status: 500 });
        if (!op) return new Response("Unauthorized", { status: 401 });

        const expires = op.run_token_expires_at ? Date.parse(op.run_token_expires_at) : 0;
        if (!expires || expires < Date.now()) {
          return new Response("Token expired", { status: 401 });
        }

        if (parsed.kind === "final") {
          const body = parsed.event;
          await finalizeOperation(supabaseAdmin as never, op as never, {
            ok: body.ok === true,
            warnings: body.warnings ?? false,
            version: body.version ?? null,
            summary: body.summary,
            errorKind: body.errorKind,
            checks: body.checks as never,
          });
          return Response.json({ ok: true, finished: true });
        }

        const steps = await applyProgressReport(supabaseAdmin as never, op as never, {
          step: parsed.event.step,
          state: parsed.event.state as "pending" | "running" | "done" | "error",
          detail: parsed.event.detail,
          percent: parsed.event.percent,

        });
        return Response.json({ ok: true, steps: steps.length });
      },
    },
  },
});

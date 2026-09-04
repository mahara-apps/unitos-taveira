import { createFileRoute } from "@tanstack/react-router";

/**
 * Public status page for a Meta data-deletion confirmation code.
 * Meta shows this URL to the user so they can verify the request completed.
 */
export const Route = createFileRoute("/api/public/meta/deletion-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code")?.trim();
        if (!code) return html(renderPage("missing", null), 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("meta_compliance_events")
          .select("event_type, status, created_at, affected_connections")
          .eq("confirmation_code", code)
          .maybeSingle();

        if (!row) return html(renderPage("not_found", null), 404);
        return html(renderPage("ok", { ...row, confirmation_code: code }), 200);
      },
    },
  },
});

function html(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function renderPage(
  state: "ok" | "missing" | "not_found",
  data: {
    confirmation_code: string;
    event_type: string;
    status: string;
    created_at: string;
    affected_connections: number;
  } | null,
): string {
  const title =
    state === "ok"
      ? "Solicitação concluída"
      : state === "not_found"
        ? "Código não encontrado"
        : "Código ausente";
  const detail =
    state === "ok" && data
      ? `<p><strong>Tipo:</strong> ${escapeHtml(data.event_type)}</p>
         <p><strong>Status:</strong> ${escapeHtml(data.status)}</p>
         <p><strong>Registros afetados:</strong> ${data.affected_connections}</p>
         <p><strong>Recebido em:</strong> ${escapeHtml(new Date(data.created_at).toLocaleString("pt-BR"))}</p>
         <p><strong>Código:</strong> <code>${escapeHtml(data.confirmation_code)}</code></p>`
      : `<p>Não localizamos essa solicitação. Se você acabou de removê-la no Facebook, aguarde alguns instantes e tente novamente.</p>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)} — Unitos</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#f4f4f5}
  .card{max-width:520px;padding:32px;border:1px solid #27272a;border-radius:16px;background:#111114}
  h1{font-size:20px;margin:0 0 12px}
  p{color:#a1a1aa;font-size:14px;margin:6px 0}
  code{background:#1f1f24;padding:2px 6px;border-radius:6px;font-size:12px}
</style></head><body>
<div class="card"><h1>${escapeHtml(title)}</h1>${detail}</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

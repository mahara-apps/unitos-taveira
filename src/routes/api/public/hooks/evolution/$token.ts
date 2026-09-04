// Receptor de webhooks da Evolution API.
// Identificação: o token da URL (e/ou header `x-evolution-token`) resolve a
// instalação/instância. Sem token válido nada é lido nem gravado.
// Escopo desta fase: persistir eventos de conexão/estado. Mensagens não são
// tratadas aqui.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/evolution/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const {
          normalizeEvolutionEvent,
          safeEventPayload,
          safeTokenEquals,
        } = await import("@/lib/evolution/webhook.server");

        const urlToken = String(params.token ?? "");
        if (urlToken.length < 32 || urlToken.length > 128) {
          return new Response("Unauthorized", { status: 401 });
        }

        const raw = await request.text();
        if (raw.length > 512_000) return new Response("Payload too large", { status: 413 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: instance, error } = await supabaseAdmin
          .from("evolution_instances")
          .select("id, brand_id, client_id, instance_name, webhook_token")
          .eq("webhook_token", urlToken)
          .maybeSingle();
        if (error) {
          console.error("[Evolution webhook] falha ao resolver instância", error);
          return new Response("Server error", { status: 500 });
        }
        // Comparação de tempo constante mesmo após o match por índice.
        if (!instance || !safeTokenEquals(instance.webhook_token as string, urlToken)) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Quando a Evolution envia o header configurado, ele também é validado.
        const headerToken = request.headers.get("x-evolution-token");
        if (headerToken && !safeTokenEquals(headerToken, urlToken)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: unknown = null;
        try {
          payload = raw.length ? JSON.parse(raw) : {};
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const event = normalizeEvolutionEvent(payload);

        // O evento precisa pertencer à instância dona do token.
        if (
          event.instanceName &&
          event.instanceName.toLowerCase() !== String(instance.instance_name).toLowerCase()
        ) {
          return new Response("Instance mismatch", { status: 409 });
        }

        const receivedAt = new Date().toISOString();
        const { error: insertError } = await supabaseAdmin.from("evolution_events").insert({
          instance_id: instance.id as string,
          brand_id: instance.brand_id as string,
          client_id: (instance.client_id as string | null) ?? null,
          instance_name: instance.instance_name as string,
          event_type: event.eventType,
          provider_event_id: event.providerEventId,
          connection_state: event.connectionState,
          phone_number: event.phoneNumber,
          payload: safeEventPayload(payload) as never,
          received_at: receivedAt,
        });
        // 23505 = evento repetido (índice de deduplicação): idempotente.
        if (insertError && insertError.code !== "23505") {
          console.error("[Evolution webhook] falha ao persistir evento", insertError);
          return new Response("Server error", { status: 500 });
        }

        if (event.instanceStatus) {
          const update: Record<string, unknown> = {
            status: event.instanceStatus,
            last_state_at: receivedAt,
            last_event_at: receivedAt,
          };
          if (event.connectionState) update["connection_state"] = event.connectionState;
          if (event.instanceStatus === "connected") {
            update["last_error"] = null;
            if (event.phoneNumber) update["phone_number"] = event.phoneNumber;
          }
          if (event.instanceStatus === "disconnected" || event.instanceStatus === "missing") {
            update["phone_number"] = null;
          }
          await supabaseAdmin
            .from("evolution_instances")
            .update(update as never)
            .eq("id", instance.id as string);
        } else {
          await supabaseAdmin
            .from("evolution_instances")
            .update({ last_event_at: receivedAt })
            .eq("id", instance.id as string);
        }

        return Response.json({ received: true });
      },
    },
  },
});

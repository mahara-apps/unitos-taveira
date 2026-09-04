import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  EVENTS,
  getEvent,
  getDefault,
  renderTemplateString,
  buildSampleContext,
  type Channel,
} from "./message-templates.catalog";

const brandIdSchema = z.object({ brandId: z.string().uuid() });

export type TemplateRecord = {
  id: string;
  brand_id: string;
  event_key: string;
  channel: Channel;
  subject: string | null;
  body: string;
  is_active: boolean;
  updated_at: string;
};

export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => brandIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("message_templates")
      .select("id, brand_id, event_key, channel, subject, body, is_active, updated_at")
      .eq("brand_id", data.brandId);
    if (error) throw new Error(error.message);
    return { templates: (rows ?? []) as TemplateRecord[] };
  });

const upsertSchema = z.object({
  brandId: z.string().uuid(),
  eventKey: z.string().min(1),
  channel: z.enum(["email", "whatsapp"]),
  subject: z.string().max(300).optional().nullable(),
  body: z.string().min(1).max(20000),
  isActive: z.boolean().default(true),
});

export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => upsertSchema.parse(data))
  .handler(async ({ data, context }) => {
    const event = getEvent(data.eventKey);
    if (!event) throw new Error("evento_desconhecido");
    if (!event.channels.includes(data.channel)) throw new Error("canal_invalido_para_evento");
    const variablesUsed = Array.from(
      new Set([...data.body.matchAll(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g)].map((m) => m[1])),
    );
    const { data: row, error } = await context.supabase
      .from("message_templates")
      .upsert(
        {
          brand_id: data.brandId,
          event_key: data.eventKey,
          channel: data.channel,
          subject: data.subject ?? null,
          body: data.body,
          is_active: data.isActive,
          variables_used: variablesUsed,
          updated_by: context.userId,
        },
        { onConflict: "brand_id,event_key,channel" },
      )
      .select("id, brand_id, event_key, channel, subject, body, is_active, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return { template: row as TemplateRecord };
  });

const resetSchema = z.object({
  brandId: z.string().uuid(),
  eventKey: z.string().min(1),
  channel: z.enum(["email", "whatsapp"]),
});

export const resetTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => resetSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("message_templates")
      .delete()
      .eq("brand_id", data.brandId)
      .eq("event_key", data.eventKey)
      .eq("channel", data.channel);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const testSchema = z.object({
  brandId: z.string().uuid(),
  eventKey: z.string().min(1),
  channel: z.enum(["email", "whatsapp"]),
  subject: z.string().optional().nullable(),
  body: z.string().min(1),
  to: z.string().min(3).max(200),
});

export const sendTestMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => testSchema.parse(data))
  .handler(async ({ data, context }) => {
    const event = getEvent(data.eventKey);
    if (!event) throw new Error("evento_desconhecido");
    // Escopo: o client autenticado (RLS) só alcança credenciais/instâncias da
    // marca do próprio usuário — as MESMAS lidas pelo status exibido na UI.
    const { assertBrandMember } = await import("@/lib/access-guard");
    await assertBrandMember(context.supabase, context.userId, data.brandId);

    // Contexto do teste: valores REAIS da instalação/marca atual têm prioridade
    // absoluta; a amostra do catálogo só preenche variáveis sem fonte real
    // (ex.: métricas de relatório). Antes o teste usava só a amostra, exibindo
    // nome de agência e URLs de outra instalação.
    const { resolveEventContext } = await import("@/lib/message-templates/context.server");
    let realCtx: Record<string, string> = {};
    try {
      realCtx = await resolveEventContext(context.supabase as never, {
        brandId: data.brandId,
        userId: context.userId,
      });
    } catch (e) {
      console.error("[template test] contexto real indisponível", e);
    }
    const ctx = { ...buildSampleContext(event), ...realCtx };
    const subject = renderTemplateString(data.subject ?? "", ctx);
    const body = renderTemplateString(data.body, ctx);

    if (data.channel === "email") {
      const { sendBrandEmail } = await import("@/lib/email/resend.server");
      const result = await sendBrandEmail(context.supabase, data.brandId, {
        to: data.to,
        subject,
        html: body,
      });
      if (!result.sent) return { sent: false, error: result.error ?? "falha_no_envio" };
      return { sent: true, previewSubject: subject, previewBody: body, from: result.from };
    }

    // WhatsApp: usa a MESMA instância Evolution conectada da marca (fim do
    // falso negativo "whatsapp_provider_nao_configurado" com canal conectado).
    const { parseDestination, maskDestination } = await import("@/lib/whatsapp/destination");
    const destination = parseDestination("phone", data.to);
    if (!destination) return { sent: false, error: "telefone_invalido", previewBody: body };

    const { data: instances } = await context.supabase
      .from("evolution_instances")
      .select("id, instance_name, status, connection_state, updated_at")
      .eq("brand_id", data.brandId)
      .order("updated_at", { ascending: false })
      .limit(20);
    const instance = (instances ?? []).find(
      (i) => i.status === "connected" || i.connection_state === "open",
    );
    if (!instance) {
      return { sent: false, error: "whatsapp_instancia_nao_conectada", previewBody: body };
    }

    try {
      const { resolveInstanceConfig } = await import("@/lib/evolution/scope.server");
      const { sendWhatsappText } = await import("@/lib/whatsapp/send.server");
      const config = await resolveInstanceConfig(context.supabase, data.brandId);
      const { providerMessageId } = await sendWhatsappText(
        config,
        instance.instance_name,
        destination,
        body,
      );
      const { logEventMessage } = await import("@/lib/message-templates/dispatch.server");
      await logEventMessage(
        context.supabase,
        context.userId,
        { brandId: data.brandId },
        {
          channel: "whatsapp",
          status: "sent",
          recipient: maskDestination(destination),
          eventKey: data.eventKey,
          source: "brand",
          metadata: { test: true, instance_id: instance.id, provider_message_id: providerMessageId },
        },
      );
      return { sent: true, previewBody: body };
    } catch (error) {
      const message = error instanceof Error ? error.message : "falha_no_envio";
      console.error(`[template test whatsapp] ${data.eventKey}: ${message}`);
      return { sent: false, error: message, previewBody: body };
    }
  });


export function listCatalog() {
  return EVENTS;
}

export function defaultForEvent(eventKey: string, channel: Channel) {
  return getDefault(eventKey, channel);
}

/**
 * Motor ÚNICO de disparo com template (server-only).
 *
 * Hierarquia de conteúdo:
 *   1. template ativo da marca em `message_templates`
 *   2. default do catálogo (`message-templates.catalog.ts`)
 *   3. erro controlado (evento/canal inexistente, ou contexto impossível)
 *
 * Nenhum evento implementa a própria lógica: todos passam por aqui.
 * Nada de dados de exemplo — o contexto vem de `context.server.ts`.
 */

import { getEvent, type Channel } from "@/lib/message-templates.catalog";
import { renderStrict, TemplateRenderError, missingVariables } from "./render";
import {
  resolveEventContext,
  type ContextSupabase,
  type EventContextInput,
} from "./context.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySupabase = ContextSupabase & Record<string, any>;

export class TemplateEventError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "TemplateEventError";
  }
}

export type RenderedMessage = {
  eventKey: string;
  channel: Channel;
  subject: string;
  body: string;
  /** De onde veio o conteúdo: template da marca ou default do catálogo. */
  source: "brand" | "catalog";
};

type TemplateRow = { subject: string | null; body: string; is_active: boolean };

/** Template ativo da marca para o par evento/canal (null quando não há). */
export async function loadBrandTemplate(
  supabase: AnySupabase,
  brandId: string,
  eventKey: string,
  channel: Channel,
): Promise<{ subject: string | null; body: string } | null> {
  try {
    const res = await supabase
      .from("message_templates")
      .select("subject, body, is_active")
      .eq("brand_id", brandId)
      .eq("event_key", eventKey)
      .eq("channel", channel)
      .maybeSingle();
    const row = (res?.data ?? null) as TemplateRow | null;
    if (!row || row.is_active === false || !row.body?.trim()) return null;
    return { subject: row.subject, body: row.body };
  } catch {
    // Indisponibilidade da tabela/RLS não pode derrubar o disparo: cai no default.
    return null;
  }
}

export async function hasBrandTemplate(
  supabase: AnySupabase,
  brandId: string,
  eventKey: string,
  channel: Channel,
): Promise<boolean> {
  return (await loadBrandTemplate(supabase, brandId, eventKey, channel)) !== null;
}

/**
 * Resolve template + contexto real e devolve o conteúdo final renderizado.
 * Lança `TemplateRenderError` quando alguma variável não tem resolução real.
 */
export async function renderEventMessage(
  supabase: AnySupabase,
  params: { eventKey: string; channel: Channel; context: EventContextInput },
): Promise<RenderedMessage> {
  const event = getEvent(params.eventKey);
  if (!event) throw new TemplateEventError("evento_desconhecido", params.eventKey);
  if (!event.channels.includes(params.channel)) {
    throw new TemplateEventError("canal_invalido_para_evento", params.channel);
  }
  const fallback = event.defaults[params.channel];
  if (!fallback) throw new TemplateEventError("template_default_inexistente", params.eventKey);

  const brandTemplate = await loadBrandTemplate(
    supabase,
    params.context.brandId,
    params.eventKey,
    params.channel,
  );
  const chosen = brandTemplate ?? fallback;
  const context = await resolveEventContext(supabase, params.context);

  const subjectTemplate = (chosen.subject ?? fallback.subject ?? "").trim();
  const body = renderStrict(chosen.body, context);
  const subject = subjectTemplate ? renderStrict(subjectTemplate, context) : "";

  return {
    eventKey: params.eventKey,
    channel: params.channel,
    subject,
    body,
    source: brandTemplate ? "brand" : "catalog",
  };
}

/** Variáveis do template escolhido que o contexto informado não resolve. */
export async function auditEventVariables(
  supabase: AnySupabase,
  params: { eventKey: string; channel: Channel; context: EventContextInput },
): Promise<string[]> {
  const event = getEvent(params.eventKey);
  const fallback = event?.defaults[params.channel];
  if (!event || !fallback) return [];
  const brandTemplate = await loadBrandTemplate(
    supabase,
    params.context.brandId,
    params.eventKey,
    params.channel,
  );
  const chosen = brandTemplate ?? fallback;
  const context = await resolveEventContext(supabase, params.context);
  return Array.from(
    new Set([
      ...missingVariables(chosen.body, context),
      ...missingVariables(chosen.subject ?? fallback.subject ?? "", context),
    ]),
  );
}

export type EventSendResult = {
  sent: boolean;
  error?: string;
  /** Conteúdo efetivamente entregue ao provider (já renderizado). */
  rendered?: RenderedMessage;
};

function logScope(brandId: string, clientId?: string | null) {
  return clientId
    ? ({ scope: "client", brandId, clientId } as const)
    : ({ scope: "workspace", brandId } as const);
}

/**
 * E-mail de evento: template → contexto real → Resend, com registro em
 * `message_logs`. Nunca grava senha temporária nem corpo com credencial.
 */
export async function sendEventEmail(
  supabase: AnySupabase,
  params: {
    eventKey: string;
    to: string;
    context: EventContextInput;
    actorUserId?: string | null;
  },
): Promise<EventSendResult> {
  let rendered: RenderedMessage;
  try {
    rendered = await renderEventMessage(supabase, {
      eventKey: params.eventKey,
      channel: "email",
      context: params.context,
    });
  } catch (error) {
    const code =
      error instanceof TemplateRenderError || error instanceof TemplateEventError
        ? error.message
        : error instanceof Error
          ? error.message
          : "falha_ao_renderizar_template";
    console.error(`[template email] ${params.eventKey} não renderizado: ${code}`);
    return { sent: false, error: code };
  }

  const { sendBrandEmail } = await import("@/lib/email/resend.server");
  const res = await sendBrandEmail(supabase as never, params.context.brandId, {
    to: params.to,
    subject: rendered.subject,
    html: rendered.body,
  });

  await logEventMessage(supabase, params.actorUserId ?? null, params.context, {
    channel: "email",
    status: res.sent ? "sent" : "failed",
    recipient: params.to,
    eventKey: params.eventKey,
    source: rendered.source,
    errorMessage: res.sent ? null : (res.error ?? "falha_no_envio"),
  });

  return res.sent
    ? { sent: true, rendered }
    : { sent: false, error: res.error ?? "falha_no_envio", rendered };
}

/**
 * WhatsApp de evento: template → contexto real → serviço Evolution existente
 * (`sendWhatsappToRecipients`), que já grava em `message_logs`.
 */
export async function sendEventWhatsapp(
  supabase: AnySupabase,
  params: {
    eventKey: string;
    context: EventContextInput;
    instanceId: string;
    recipientIds: string[];
    actorUserId?: string | null;
  },
): Promise<EventSendResult & { summary?: unknown }> {
  let rendered: RenderedMessage;
  try {
    rendered = await renderEventMessage(supabase, {
      eventKey: params.eventKey,
      channel: "whatsapp",
      context: params.context,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "falha_ao_renderizar_template";
    console.error(`[template whatsapp] ${params.eventKey} não renderizado: ${code}`);
    return { sent: false, error: code };
  }

  const { sendWhatsappToRecipients } = await import("@/lib/whatsapp/send.server");
  const summary = await sendWhatsappToRecipients(supabase as never, params.actorUserId ?? null, {
    brandId: params.context.brandId,
    instanceId: params.instanceId,
    recipientIds: params.recipientIds,
    message: rendered.body,
  });
  return { sent: summary.sent > 0, rendered, summary };
}

/** Registro padronizado do disparo (sem segredos no metadata). */
export async function logEventMessage(
  supabase: AnySupabase,
  actorUserId: string | null,
  context: EventContextInput,
  input: {
    channel: string;
    status: string;
    recipient: string;
    eventKey: string;
    source: "brand" | "catalog";
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { logMessage } = await import("@/lib/messaging-log.server");
    const actor = actorUserId
      ? ({ kind: "user", userId: actorUserId } as const)
      : ({ kind: "service_role" } as const);
    await logMessage(supabase as never, actor, logScope(context.brandId, context.clientId), {
      channel: input.channel,
      status: input.status,
      recipient: input.recipient,
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      metadata: {
        event_key: input.eventKey,
        template_source: input.source,
        ...(input.metadata ?? {}),
      },
    });
  } catch {
    // Log é observabilidade: nunca derruba o envio.
  }
}

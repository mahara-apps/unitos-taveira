import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AUTOMATION_EVENTS,
  AUTOMATION_TIMEZONE,
  AUTOMATION_TRIGGER_TYPES,
  localDateTimeToUtc,
  nextRecurringRun,
  previewAutomationMessage,
} from "@/lib/whatsapp/automation";
import { callRpc } from "@/lib/supabase-rpc";

const Scope = z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() });
const Rule = Scope.extend({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  triggerType: z.enum(AUTOMATION_TRIGGER_TYPES),
  eventKey: z.string().max(80).nullish(),
  customDateId: z.string().uuid().nullish(),
  scheduledFor: z.string().nullish(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).nullish(),
  weekday: z.number().int().min(0).max(6).nullish(),
  month: z.number().int().min(1).max(12).nullish(),
  day: z.number().int().min(1).max(31).nullish(),
  hour: z.number().int().min(0).max(23).default(9),
  minute: z.number().int().min(0).max(59).default(0),
  messageTemplate: z.string().trim().min(1).max(4096),
  recipientId: z.string().uuid(),
  instanceId: z.string().uuid(),
  isActive: z.boolean(),
});
const RuleAction = Scope.extend({ ruleId: z.string().uuid() });
const DefaultRecipient = Scope.extend({ recipientId: z.string().uuid() });
const DateInput = Scope.extend({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  dateValue: z.string().date(),
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  repeatsAnnually: z.boolean(),
});

async function assertManager(context: {
  supabase: any;
  userId: string;
}, brandId: string, clientId: string) {
  const { assertClientInBrand, resolveAuthorityRole } = await import("@/lib/access-guard");
  await assertClientInBrand(context.supabase, context.userId, brandId, clientId);
  const role = await resolveAuthorityRole(context.supabase, context.userId, brandId);
  if (role !== "super_admin" && role !== "admin") {
    throw new Error("Apenas Owner ou Admin podem gerenciar automações.");
  }
}

async function assertFeature(context: { supabase: any }, brandId: string) {
  const { data: catalog } = await context.supabase
    .from("feature_catalog")
    .select("default_enabled")
    .eq("key", "automations")
    .maybeSingle();
  const { data: configured } = await context.supabase
    .from("brand_features")
    .select("enabled")
    .eq("brand_id", brandId)
    .eq("feature_key", "automations")
    .maybeSingle();
  if (!(configured?.enabled ?? catalog?.default_enabled ?? false)) {
    throw new Error("O recurso Automações não está habilitado neste workspace.");
  }
}

async function auditAutomation(
  context: { supabase: any; userId: string },
  brandId: string,
  clientId: string,
  verb: string,
  payload: Record<string, unknown>,
) {
  const { error } = await context.supabase.from("activity_events").insert({
    brand_id: brandId,
    client_id: clientId,
    actor_id: context.userId,
    entity_type: "client_automation",
    verb,
    payload,
  } as never);
  if (error) console.warn("[whatsapp-automations] audit failed", error.message);
}

export const listClientAutomations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Scope.parse(input))
  .handler(async ({ data, context }) => {
    const { assertClientInBrand } = await import("@/lib/access-guard");
    await assertClientInBrand(context.supabase, context.userId, data.brandId, data.clientId);
    await assertFeature(context, data.brandId);
    const [rules, dates, recipients, instances, dispatches] = await Promise.all([
      context.supabase.from("client_automation_rules").select("*").eq("brand_id", data.brandId).eq("client_id", data.clientId).order("created_at", { ascending: false }),
      context.supabase.from("client_automation_dates").select("*").eq("brand_id", data.brandId).eq("client_id", data.clientId).order("date_value"),
      context.supabase.from("whatsapp_recipients").select("id,name,type,destination,is_active,is_default").eq("brand_id", data.brandId).eq("client_id", data.clientId).eq("is_active", true).order("name"),
      context.supabase.from("evolution_instances").select("id,label,instance_name,status,client_id").eq("brand_id", data.brandId).eq("status", "connected"),
      context.supabase.from("client_automation_dispatches").select("id,rule_id,status,scheduled_at,sent_at,attempts,last_error,created_at").eq("brand_id", data.brandId).eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(100),
    ]);
    for (const result of [rules, dates, recipients, instances, dispatches]) {
      if (result.error) throw result.error;
    }
    return {
      rules: rules.data ?? [],
      dates: dates.data ?? [],
      recipients: recipients.data ?? [],
      instances: (instances.data ?? []).filter((row) => !row.client_id || row.client_id === data.clientId),
      dispatches: dispatches.data ?? [],
    };
  });

export const saveClientAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Rule.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context, data.brandId, data.clientId);
    await assertFeature(context, data.brandId);
    const preview = previewAutomationMessage(data.messageTemplate);
    if (preview.unknown.length) throw new Error(`Variáveis inválidas: ${preview.unknown.join(", ")}`);
    if (data.triggerType === "system_event" && !AUTOMATION_EVENTS.some((event) => event.key === data.eventKey)) {
      throw new Error("Evento do sistema inválido.");
    }
    const [{ data: recipient }, { data: instance }] = await Promise.all([
      context.supabase.from("whatsapp_recipients").select("id").eq("id", data.recipientId).eq("brand_id", data.brandId).eq("client_id", data.clientId).eq("is_active", true).maybeSingle(),
      context.supabase.from("evolution_instances").select("id").eq("id", data.instanceId).eq("brand_id", data.brandId).eq("status", "connected").maybeSingle(),
    ]);
    if (!recipient) throw new Error("Destino inválido para este cliente.");
    if (!instance) throw new Error("Conexão de WhatsApp inválida.");
    const scheduleConfig: Record<string, unknown> = {};
    let nextRunAt: string | null = null;
    if (data.triggerType === "fixed") {
      const instant = localDateTimeToUtc(data.scheduledFor ?? "");
      if (!instant || instant <= new Date()) throw new Error("Escolha uma data futura válida.");
      scheduleConfig["scheduledFor"] = data.scheduledFor;
      nextRunAt = instant.toISOString();
    } else if (data.triggerType === "recurring") {
      if (!data.frequency) throw new Error("Selecione a recorrência.");
      Object.assign(scheduleConfig, {
        frequency: data.frequency,
        weekday: data.weekday,
        month: data.month,
        day: data.day,
        hour: data.hour,
        minute: data.minute,
      });
      nextRunAt = nextRecurringRun(scheduleConfig)?.toISOString() ?? null;
    } else if (data.triggerType === "client_date") {
      if (!data.customDateId) throw new Error("Selecione uma data do cliente.");
      scheduleConfig["hour"] = data.hour;
      scheduleConfig["minute"] = data.minute;
      const { data: dateRow } = await context.supabase.from("client_automation_dates").select("date_value,repeats_annually").eq("id", data.customDateId).eq("client_id", data.clientId).maybeSingle();
      if (!dateRow) throw new Error("Data do cliente não encontrada.");
      const now = new Date();
      const parts = String(dateRow.date_value).split("-").map(Number);
      let year = dateRow.repeats_annually ? Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: AUTOMATION_TIMEZONE }).format(now)) : parts[0];
      let candidate = localDateTimeToUtc(`${year}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}T${String(data.hour).padStart(2, "0")}:${String(data.minute).padStart(2, "0")}`);
      if (candidate && candidate <= now && dateRow.repeats_annually) {
        year += 1;
        candidate = localDateTimeToUtc(`${year}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}T${String(data.hour).padStart(2, "0")}:${String(data.minute).padStart(2, "0")}`);
      }
      nextRunAt = candidate?.toISOString() ?? null;
    }
    const payload = {
      brand_id: data.brandId, client_id: data.clientId, recipient_id: data.recipientId,
      instance_id: data.instanceId, custom_date_id: data.customDateId ?? null, name: data.name,
      trigger_type: data.triggerType, event_key: data.eventKey ?? null, schedule_config: scheduleConfig,
      message_template: data.messageTemplate, timezone: AUTOMATION_TIMEZONE, is_active: data.isActive,
      next_run_at: data.isActive ? nextRunAt : null,
    };
    const query = data.id
      ? context.supabase.from("client_automation_rules").update(payload as never).eq("id", data.id).eq("brand_id", data.brandId).eq("client_id", data.clientId)
      : context.supabase.from("client_automation_rules").insert({ ...payload, created_by: context.userId } as never);
    const { error } = await query;
    if (error) throw error;
    await auditAutomation(context, data.brandId, data.clientId, data.id ? "automation.update" : "automation.create", {
      rule_id: data.id ?? null,
      trigger_type: data.triggerType,
      active: data.isActive,
    });
    return { ok: true };
  });

export const deleteClientAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => RuleAction.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context, data.brandId, data.clientId);
    const { error } = await context.supabase.from("client_automation_rules").delete().eq("id", data.ruleId).eq("brand_id", data.brandId).eq("client_id", data.clientId);
    if (error) throw error;
    await auditAutomation(context, data.brandId, data.clientId, "automation.delete", { rule_id: data.ruleId });
    return { ok: true };
  });

export const setClientDefaultWhatsappRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => DefaultRecipient.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context, data.brandId, data.clientId);
    await assertFeature(context, data.brandId);
    const { error } = await callRpc(context.supabase, "set_client_default_whatsapp_recipient", {
      _brand_id: data.brandId,
      _client_id: data.clientId,
      _recipient_id: data.recipientId,
    });
    if (error) throw error;
    await auditAutomation(context, data.brandId, data.clientId, "automation.default_destination", { recipient_id: data.recipientId });
    return { ok: true };
  });

export const saveClientAutomationDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => DateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context, data.brandId, data.clientId);
    const payload = { brand_id: data.brandId, client_id: data.clientId, name: data.name, date_value: data.dateValue, send_time: data.sendTime, repeats_annually: data.repeatsAnnually, created_by: context.userId };
    const query = data.id ? context.supabase.from("client_automation_dates").update(payload as never).eq("id", data.id).eq("client_id", data.clientId) : context.supabase.from("client_automation_dates").insert(payload as never);
    const { error } = await query;
    if (error) throw error;
    await auditAutomation(context, data.brandId, data.clientId, data.id ? "automation.date_update" : "automation.date_create", {
      date_id: data.id ?? null,
      repeats_annually: data.repeatsAnnually,
    });
    return { ok: true };
  });
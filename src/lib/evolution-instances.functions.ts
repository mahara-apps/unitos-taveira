// Gerenciamento de instâncias Evolution exposto ao app: criar, consultar
// estado, reiniciar, desconectar e excluir. Cada instância fica vinculada ao
// workspace (brand) e, quando aplicável, a um cliente.
// Sem QR, webhook, inbox ou envio de mensagens.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ListInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid().nullish(),
});

const CreateInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid().nullish(),
  label: z.string().trim().min(2).max(80),
});

const InstanceInput = z.object({
  brandId: z.string().uuid(),
  instanceId: z.string().uuid(),
});

export type EvolutionInstanceRow = {
  id: string;
  brandId: string;
  clientId: string | null;
  clientName: string | null;
  instanceName: string;
  label: string | null;
  status: string;
  connectionState: string | null;
  phoneNumber: string | null;
  lastStateAt: string | null;
  lastError: string | null;
  createdAt: string;
};

/** Lista as instâncias visíveis do workspace (RLS aplica o escopo por cliente). */
export const listEvolutionInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }): Promise<EvolutionInstanceRow[]> => {
    const { assertBrandMember } = await import("@/lib/access-guard");
    await assertBrandMember(context.supabase, context.userId, data.brandId);

    let query = context.supabase
      .from("evolution_instances")
      .select("*, clients(name)")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false });
    if (data.clientId) query = query.eq("client_id", data.clientId);

    const { data: rows, error } = await query;
    if (error) throw error;

    return (rows ?? []).map((row) => {
      const client = row.clients as { name: string | null } | null;
      return {
        id: row.id as string,
        brandId: row.brand_id as string,
        clientId: (row.client_id as string | null) ?? null,
        clientName: client?.name ?? null,
        instanceName: row.instance_name as string,
        label: (row.label as string | null) ?? null,
        status: row.status as string,
        connectionState: (row.connection_state as string | null) ?? null,
        phoneNumber: (row.phone_number as string | null) ?? null,
        lastStateAt: (row.last_state_at as string | null) ?? null,
        lastError: (row.last_error as string | null) ?? null,
        createdAt: row.created_at as string,
      };
    });
  });

/** Cria a instância na Evolution e registra o vínculo workspace/cliente. */
export const createEvolutionInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertBrandAdmin, assertClientInBrand } = await import("@/lib/access-guard");
    await assertBrandAdmin(context.supabase, context.userId, data.brandId);
    const clientId = data.clientId ?? null;
    if (clientId) {
      await assertClientInBrand(context.supabase, context.userId, data.brandId, clientId);
    }

    const { resolveInstanceConfig } = await import("./evolution/scope.server");
    const config = await resolveInstanceConfig(context.supabase, data.brandId);

    const { buildInstanceName, createEvolutionInstance: createRemote } =
      await import("./evolution/instances.server");
    const instanceName = buildInstanceName(data.brandId, clientId, data.label);

    const { data: existing } = await context.supabase
      .from("evolution_instances")
      .select("id")
      .eq("brand_id", data.brandId)
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (existing) throw new Error("Já existe uma instância com este nome neste workspace.");

    await createRemote(config, instanceName);

    const { data: inserted, error } = await context.supabase
      .from("evolution_instances")
      .insert({
        brand_id: data.brandId,
        client_id: clientId,
        instance_name: instanceName,
        label: data.label,
        status: "created",
        connection_state: "close",
        last_state_at: new Date().toISOString(),
        created_by: context.userId,
      })
      .select("id, instance_name")
      .single();
    if (error) throw error;

    return { ok: true, id: inserted.id as string, instanceName: inserted.instance_name as string };
  });

/** Consulta o estado atual no provedor e persiste o resultado. */
export const refreshEvolutionInstanceState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InstanceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { loadInstance, resolveInstanceConfig } = await import("./evolution/scope.server");
    const { assertBrandMember } = await import("@/lib/access-guard");
    await assertBrandMember(context.supabase, context.userId, data.brandId);

    const instance = await loadInstance(context.supabase, data.brandId, data.instanceId);
    const config = await resolveInstanceConfig(context.supabase, data.brandId);
    const { fetchEvolutionInstanceState } = await import("./evolution/instances.server");

    const state = await fetchEvolutionInstanceState(config, instance.instance_name);
    const status =
      state.state === "open"
        ? "connected"
        : state.state === "connecting"
          ? "connecting"
          : state.state === "not_found"
            ? "missing"
            : "disconnected";

    await context.supabase
      .from("evolution_instances")
      .update({
        status,
        connection_state: state.state,
        phone_number: state.phoneNumber,
        last_state_at: new Date().toISOString(),
        last_error: state.state === "not_found" ? "Instância inexistente no servidor Evolution." : null,
      })
      .eq("id", instance.id);

    return { status, state: state.state, phoneNumber: state.phoneNumber };
  });

/** Reinicia a instância no provedor. */
export const restartEvolutionInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InstanceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertInstanceAdmin, loadInstance, resolveInstanceConfig } =
      await import("./evolution/scope.server");
    const instance = await loadInstance(context.supabase, data.brandId, data.instanceId);
    await assertInstanceAdmin(context.supabase, context.userId, data.brandId, instance.client_id);

    const config = await resolveInstanceConfig(context.supabase, data.brandId);
    const { restartEvolutionInstance: restartRemote } = await import("./evolution/instances.server");
    await restartRemote(config, instance.instance_name);

    await context.supabase
      .from("evolution_instances")
      .update({
        status: "connecting",
        connection_state: "connecting",
        last_state_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", instance.id);

    return { ok: true };
  });

/** Desconecta o número (logout) mantendo a instância registrada. */
export const disconnectEvolutionInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InstanceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertInstanceAdmin, loadInstance, resolveInstanceConfig } =
      await import("./evolution/scope.server");
    const instance = await loadInstance(context.supabase, data.brandId, data.instanceId);
    await assertInstanceAdmin(context.supabase, context.userId, data.brandId, instance.client_id);

    const config = await resolveInstanceConfig(context.supabase, data.brandId);
    const { logoutEvolutionInstance } = await import("./evolution/instances.server");
    const result = await logoutEvolutionInstance(config, instance.instance_name);

    await context.supabase
      .from("evolution_instances")
      .update({
        status: result.missing ? "missing" : "disconnected",
        connection_state: result.missing ? "not_found" : "close",
        phone_number: null,
        last_state_at: new Date().toISOString(),
        last_error: result.missing ? "Instância inexistente no servidor Evolution." : null,
      })
      .eq("id", instance.id);

    return { ok: true, missing: result.missing };
  });

/** Exclui a instância no provedor e remove o registro do workspace. */
export const deleteEvolutionInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InstanceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertInstanceAdmin, loadInstance, resolveInstanceConfig } =
      await import("./evolution/scope.server");
    const instance = await loadInstance(context.supabase, data.brandId, data.instanceId);
    await assertInstanceAdmin(context.supabase, context.userId, data.brandId, instance.client_id);

    const config = await resolveInstanceConfig(context.supabase, data.brandId);
    const { deleteEvolutionInstance: deleteRemote } = await import("./evolution/instances.server");
    const result = await deleteRemote(config, instance.instance_name);

    const { error } = await context.supabase
      .from("evolution_instances")
      .delete()
      .eq("id", instance.id);
    if (error) throw error;

    return { ok: true, missing: result.missing };
  });

export type EvolutionQrResult = {
  status: string;
  connected: boolean;
  qrBase64: string | null;
  qrCode: string | null;
  pairingCode: string | null;
  count: number | null;
  requestedAt: string;
  message: string | null;
};

/**
 * Solicita o QR Code de pareamento da instância e persiste o estado
 * "aguardando leitura". Quando o provedor informa que já está conectada,
 * devolve o estado conectado sem QR.
 */
export const requestEvolutionInstanceQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InstanceInput.parse(input))
  .handler(async ({ data, context }): Promise<EvolutionQrResult> => {
    const { assertInstanceAdmin, loadInstance, resolveInstanceConfig } =
      await import("./evolution/scope.server");
    const instance = await loadInstance(context.supabase, data.brandId, data.instanceId);
    await assertInstanceAdmin(context.supabase, context.userId, data.brandId, instance.client_id);

    const config = await resolveInstanceConfig(context.supabase, data.brandId);
    const { requestEvolutionQr, describeQrFailure } = await import("./evolution/qr.server");

    let payload;
    try {
      payload = await requestEvolutionQr(config, instance.instance_name);
    } catch (error) {
      const message = describeQrFailure(error);
      await context.supabase
        .from("evolution_instances")
        .update({ last_error: message, last_state_at: new Date().toISOString() })
        .eq("id", instance.id);
      throw new Error(message);
    }

    const hasQr = Boolean(payload.qrBase64 || payload.qrCode);
    const status = payload.alreadyConnected ? "connected" : hasQr ? "qr_pending" : "connecting";

    await context.supabase
      .from("evolution_instances")
      .update({
        status,
        connection_state: payload.alreadyConnected ? "open" : "connecting",
        last_state_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", instance.id);

    return {
      status,
      connected: payload.alreadyConnected,
      qrBase64: payload.qrBase64,
      qrCode: payload.qrCode,
      pairingCode: payload.pairingCode,
      count: payload.count,
      requestedAt: payload.requestedAt,
      message: payload.alreadyConnected
        ? "Esta instância já está conectada."
        : hasQr
          ? null
          : "O servidor Evolution não devolveu um QR Code. Tente novamente em instantes.",
    };
  });

/**
 * Registra o webhook desta instância no servidor Evolution, gerando um token
 * secreto próprio (usado na URL e no header `x-evolution-token`).
 */
export const configureEvolutionWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InstanceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertInstanceAdmin, loadInstance, resolveInstanceConfig } =
      await import("./evolution/scope.server");
    const instance = await loadInstance(context.supabase, data.brandId, data.instanceId);
    await assertInstanceAdmin(context.supabase, context.userId, data.brandId, instance.client_id);

    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const configuredBase = process.env["EVOLUTION_WEBHOOK_BASE_URL"] ?? process.env["APP_PUBLIC_URL"];
    const host = getRequestHeader("x-forwarded-host") ?? getRequestHeader("host");
    const appBaseUrl = configuredBase ?? (host ? `https://${host}` : null);
    if (!appBaseUrl) {
      throw new Error("URL pública da aplicação indisponível para registrar o webhook.");
    }

    const { buildWebhookUrl, generateWebhookToken, setEvolutionWebhook } =
      await import("./evolution/webhook.server");

    const { data: current } = await context.supabase
      .from("evolution_instances")
      .select("webhook_token")
      .eq("id", instance.id)
      .maybeSingle();
    const token = (current?.webhook_token as string | null) ?? generateWebhookToken();
    const webhookUrl = buildWebhookUrl(appBaseUrl, token);

    const config = await resolveInstanceConfig(context.supabase, data.brandId);
    await setEvolutionWebhook(config, instance.instance_name, webhookUrl, token);

    const { error } = await context.supabase
      .from("evolution_instances")
      .update({ webhook_token: token, webhook_configured_at: new Date().toISOString() })
      .eq("id", instance.id);
    if (error) throw error;

    return { ok: true, webhookUrl };
  });

export type EvolutionEventRow = {
  id: string;
  instanceId: string;
  instanceName: string;
  eventType: string;
  connectionState: string | null;
  phoneNumber: string | null;
  receivedAt: string;
};

const EventsInput = InstanceInput.extend({ limit: z.number().int().min(1).max(100).optional() });

/** Últimos eventos recebidos por webhook para a instância (RLS aplica o escopo). */
export const listEvolutionInstanceEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EventsInput.parse(input))
  .handler(async ({ data, context }): Promise<EvolutionEventRow[]> => {
    const { assertBrandMember } = await import("@/lib/access-guard");
    await assertBrandMember(context.supabase, context.userId, data.brandId);

    const { data: rows, error } = await context.supabase
      .from("evolution_events")
      .select("id, instance_id, instance_name, event_type, connection_state, phone_number, received_at")
      .eq("brand_id", data.brandId)
      .eq("instance_id", data.instanceId)
      .order("received_at", { ascending: false })
      .limit(data.limit ?? 20);
    if (error) throw error;

    return (rows ?? []).map((row) => ({
      id: row.id as string,
      instanceId: row.instance_id as string,
      instanceName: row.instance_name as string,
      eventType: row.event_type as string,
      connectionState: (row.connection_state as string | null) ?? null,
      phoneNumber: (row.phone_number as string | null) ?? null,
      receivedAt: row.received_at as string,
    }));
  });

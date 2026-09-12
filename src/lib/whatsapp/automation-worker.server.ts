import { callRpc } from "@/lib/supabase-rpc";
import { renderStrict } from "@/lib/message-templates/render";
import { resolveEventContext } from "@/lib/message-templates/context.server";
import { nextRecurringRun, localDateTimeToUtc } from "@/lib/whatsapp/automation";
import { sendWhatsappToRecipients } from "@/lib/whatsapp/send.server";

type AdminClient = any;

const RETRY_SECONDS = [60, 300, 1_800, 7_200];

export async function enqueueDueClientAutomations(admin: AdminClient): Promise<number> {
  const now = new Date();
  const dueWindow = new Date(now.getTime() - 60_000).toISOString();
  const { data: dueTasks, error: dueTasksError } = await admin
    .from("tasks")
    .select("id,brand_id,client_id,title,due_at")
    .eq("done", false)
    .not("client_id", "is", null)
    .lte("due_at", now.toISOString())
    .gt("due_at", dueWindow)
    .limit(100);
  if (dueTasksError) throw dueTasksError;
  for (const task of dueTasks ?? []) {
    await callRpc(admin, "enqueue_client_automation_event", {
      _brand_id: task.brand_id,
      _client_id: task.client_id,
      _event_key: "task.due",
      _entity_key: String(task.id),
      _context: { task: { id: task.id, title: task.title, due_at: task.due_at } },
    });
  }
  const overdueStart = new Date(now.getTime() - 120_000).toISOString();
  const overdueEnd = new Date(now.getTime() - 60_000).toISOString();
  const { data: overdueTasks, error: overdueTasksError } = await admin
    .from("tasks")
    .select("id,brand_id,client_id,title,due_at")
    .eq("done", false)
    .not("client_id", "is", null)
    .lte("due_at", overdueEnd)
    .gt("due_at", overdueStart)
    .limit(100);
  if (overdueTasksError) throw overdueTasksError;
  for (const task of overdueTasks ?? []) {
    await callRpc(admin, "enqueue_client_automation_event", {
      _brand_id: task.brand_id,
      _client_id: task.client_id,
      _event_key: "task.overdue",
      _entity_key: String(task.id),
      _context: { task: { id: task.id, title: task.title, due_at: task.due_at } },
    });
  }
  const { data: pendingBriefings, error: pendingBriefingsError } = await admin
    .from("brand_briefing_requests")
    .select("id,brand_id,client_id,due_at")
    .eq("status", "requested")
    .lte("due_at", now.toISOString())
    .gt("due_at", dueWindow)
    .limit(100);
  if (pendingBriefingsError) throw pendingBriefingsError;
  for (const briefing of pendingBriefings ?? []) {
    await callRpc(admin, "enqueue_client_automation_event", {
      _brand_id: briefing.brand_id,
      _client_id: briefing.client_id,
      _event_key: "briefing.pending",
      _entity_key: String(briefing.id),
      _context: { briefing: { id: briefing.id, due_at: briefing.due_at } },
    });
  }
  const { data: due, error } = await admin
    .from("client_automation_rules")
    .select("*, client_automation_dates(date_value,repeats_annually,name)")
    .eq("is_active", true)
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString())
    .limit(100);
  if (error) throw error;
  let enqueued = 0;
  for (const rule of due ?? []) {
    const { data: feature } = await admin
      .from("brand_features")
      .select("enabled")
      .eq("brand_id", rule.brand_id)
      .eq("feature_key", "automations")
      .maybeSingle();
    if (!feature?.enabled) continue;
    const occurrence = `scheduled:${rule.next_run_at}`;
    const dateRow = Array.isArray(rule.client_automation_dates)
      ? rule.client_automation_dates[0]
      : rule.client_automation_dates;
    const context = dateRow
      ? { date: { name: dateRow.name, value: dateRow.date_value } }
      : {};
    const inserted = await admin.from("client_automation_dispatches").insert({
      brand_id: rule.brand_id,
      client_id: rule.client_id,
      rule_id: rule.id,
      recipient_id: rule.recipient_id,
      instance_id: rule.instance_id,
      occurrence_key: occurrence,
      scheduled_at: rule.next_run_at,
      event_context: context,
    });
    if (!inserted.error) enqueued++;
    else if (inserted.error.code !== "23505") throw inserted.error;

    let next: string | null = null;
    if (rule.trigger_type === "recurring") {
      next = nextRecurringRun(rule.schedule_config ?? {}, new Date(rule.next_run_at))?.toISOString() ?? null;
    } else if (rule.trigger_type === "client_date" && dateRow?.repeats_annually) {
      const [, month, day] = String(dateRow.date_value).split("-").map(Number);
      const year = new Date(rule.next_run_at).getUTCFullYear();
      const nextDate = localDateTimeToUtc(
        `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(rule.schedule_config?.hour ?? 9).padStart(2, "0")}:${String(rule.schedule_config?.minute ?? 0).padStart(2, "0")}`,
      );
      next = nextDate?.toISOString() ?? null;
    }
    await admin.from("client_automation_rules").update({
      next_run_at: next,
      last_run_at: rule.next_run_at,
      is_active: next ? true : false,
      updated_at: now.toISOString(),
    }).eq("id", rule.id).eq("next_run_at", rule.next_run_at);
  }
  return enqueued;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Falha ao processar automação.";
}

async function notifyFinalFailure(admin: AdminClient, dispatch: any, message: string) {
  const { data: members } = await admin
    .from("brand_members")
    .select("user_id")
    .eq("brand_id", dispatch.brand_id)
    .eq("is_active", true)
    .in("role", ["owner", "admin"]);
  const rows = (members ?? []).map((member: { user_id: string }) => ({
    user_id: member.user_id,
    brand_id: dispatch.brand_id,
    kind: "system",
    title: "Automação de WhatsApp falhou",
    body: message,
    href: `/customers/${dispatch.client_id}?tab=automacoes`,
    dedupe_key: `whatsapp-automation-failed:${dispatch.id}`,
    payload: { dispatch_id: dispatch.id, rule_id: dispatch.rule_id },
  }));
  if (rows.length) await admin.from("notifications").insert(rows);
}

export async function processClientAutomationQueue(admin: AdminClient) {
  const workerId = crypto.randomUUID();
  const { data: claimed, error } = await callRpc(admin, "claim_client_automation_dispatches", {
    _owner: workerId,
    _limit: 25,
    _lease_seconds: 300,
  });
  if (error) throw error;
  const results: Array<{ id: string; status: string }> = [];
  for (const dispatch of (claimed ?? []) as any[]) {
    try {
      const { data: rule, error: ruleError } = await admin
        .from("client_automation_rules")
        .select("message_template,name")
        .eq("id", dispatch.rule_id)
        .maybeSingle();
      if (ruleError || !rule) throw ruleError ?? new Error("Regra removida.");
      const raw = dispatch.event_context ?? {};
      const base = await resolveEventContext(admin, {
        brandId: dispatch.brand_id,
        clientId: dispatch.client_id,
        userId: raw.userId ?? null,
        post: raw.post ?? null,
        task: raw.task ?? null,
        portal: raw.portal ?? null,
      });
      const context = {
        ...base,
        ...(raw.date?.name ? { "date.name": String(raw.date.name) } : {}),
        ...(raw.date?.value ? { "date.value": String(raw.date.value) } : {}),
      };
      const message = renderStrict(rule.message_template, context);
      const summary = await sendWhatsappToRecipients(admin, null, {
        brandId: dispatch.brand_id,
        instanceId: dispatch.instance_id,
        recipientIds: [dispatch.recipient_id],
        message,
      });
      const item = summary.results[0];
      if (!item || item.status !== "sent") throw new Error(item?.error ?? "Envio não concluído.");
      await admin.from("client_automation_attempts").insert({
        dispatch_id: dispatch.id, brand_id: dispatch.brand_id, client_id: dispatch.client_id,
        attempt_number: dispatch.attempts, status: "sent", masked_destination: item.destination,
        provider_message_id: item.providerMessageId,
      });
      await admin.from("client_automation_dispatches").update({
        status: "sent", sent_at: new Date().toISOString(), rendered_message: message,
        last_error: null, retry_at: null, locked_at: null, lock_owner: null,
      }).eq("id", dispatch.id).eq("lock_owner", workerId);
      results.push({ id: dispatch.id, status: "sent" });
    } catch (caught) {
      const message = safeError(caught);
      const final = dispatch.attempts >= dispatch.max_attempts;
      const retryAt = final
        ? null
        : new Date(Date.now() + RETRY_SECONDS[Math.min(dispatch.attempts - 1, RETRY_SECONDS.length - 1)] * 1000).toISOString();
      await admin.from("client_automation_attempts").insert({
        dispatch_id: dispatch.id, brand_id: dispatch.brand_id, client_id: dispatch.client_id,
        attempt_number: dispatch.attempts, status: "failed", error_message: message,
      });
      await admin.from("client_automation_dispatches").update({
        status: final ? "failed" : "retry", last_error: message, retry_at: retryAt,
        locked_at: null, lock_owner: null,
      }).eq("id", dispatch.id).eq("lock_owner", workerId);
      if (final) await notifyFinalFailure(admin, dispatch, message);
      results.push({ id: dispatch.id, status: final ? "failed" : "retry" });
    }
  }
  return results;
}
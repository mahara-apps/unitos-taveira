import { APP_TIMEZONE, zonedParts, zonedTimeToUtc } from "@/lib/timezone";
import { extractVariables } from "@/lib/message-templates/render";

export const AUTOMATION_TRIGGER_TYPES = [
  "fixed",
  "recurring",
  "system_event",
  "client_date",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];
export type AutomationFrequency = "daily" | "weekly" | "monthly" | "yearly";

export const AUTOMATION_EVENTS = [
  { key: "approval.requested", label: "Conteúdo aguardando aprovação" },
  { key: "approval.approved", label: "Conteúdo aprovado" },
  { key: "approval.rework", label: "Ajustes solicitados" },
  { key: "task.assigned", label: "Tarefa atribuída" },
  { key: "task.due", label: "Prazo de tarefa" },
  { key: "task.overdue", label: "Tarefa atrasada" },
  { key: "publication.scheduled", label: "Publicação agendada" },
  { key: "publication.published", label: "Publicação concluída" },
  { key: "publication.failed", label: "Falha de publicação" },
  { key: "portal.access", label: "Acesso ao portal" },
  { key: "briefing.requested", label: "Briefing solicitado" },
  { key: "briefing.pending", label: "Briefing pendente" },
] as const;

export const AUTOMATION_VARIABLES = [
  { key: "brand.name", label: "Nome da agência" },
  { key: "client.name", label: "Nome do cliente" },
  { key: "client.contact_name", label: "Contato do cliente" },
  { key: "post.title", label: "Título do conteúdo" },
  { key: "post.channel", label: "Canal da publicação" },
  { key: "post.scheduled_at", label: "Data da publicação" },
  { key: "task.title", label: "Título da tarefa" },
  { key: "task.due_at", label: "Prazo da tarefa" },
  { key: "portal.url", label: "Link do portal" },
  { key: "portal.expires_at", label: "Validade do portal" },
  { key: "date.name", label: "Nome da data" },
  { key: "date.value", label: "Data especial" },
] as const;

export const AUTOMATION_SAMPLE_CONTEXT: Record<string, string> = {
  "brand.name": "Sua agência",
  "client.name": "Cliente exemplo",
  "client.contact_name": "Contato",
  "post.title": "Campanha de lançamento",
  "post.channel": "Instagram",
  "post.scheduled_at": "15/09/2026 09:00",
  "task.title": "Revisar conteúdo",
  "task.due_at": "15/09/2026",
  "portal.url": "https://exemplo.com/portal/cliente",
  "portal.expires_at": "30/09/2026",
  "date.name": "Aniversário da empresa",
  "date.value": "15/09/2026",
};

export function previewAutomationMessage(template: string): {
  message: string;
  unknown: string[];
} {
  const known = new Set(AUTOMATION_VARIABLES.map((item) => item.key));
  const unknown = extractVariables(template).filter((key) => !known.has(key as never));
  const message = template.replace(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (raw, key: string) => {
    return AUTOMATION_SAMPLE_CONTEXT[key] ?? raw;
  });
  return { message, unknown };
}

export function localDateTimeToUtc(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return zonedTimeToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
}

export function nextRecurringRun(
  config: Record<string, unknown>,
  after = new Date(),
): Date | null {
  const frequency = String(config["frequency"] ?? "") as AutomationFrequency;
  const hour = Number(config["hour"] ?? 9);
  const minute = Number(config["minute"] ?? 0);
  const base = zonedParts(new Date(after.getTime() + 60_000));

  for (let add = 0; add <= 370; add++) {
    const candidate = zonedTimeToUtc(base.year, base.month, base.day + add, hour, minute);
    if (candidate <= after) continue;
    const p = zonedParts(candidate);
    if (frequency === "daily") return candidate;
    if (frequency === "weekly" && p.day !== undefined) {
      const weekday = Number(config["weekday"] ?? 1);
      const actual = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
      if (actual === weekday) return candidate;
    }
    if (frequency === "monthly" && p.day === Number(config["day"] ?? 1)) return candidate;
    if (
      frequency === "yearly" &&
      p.month === Number(config["month"] ?? 1) &&
      p.day === Number(config["day"] ?? 1)
    ) {
      return candidate;
    }
  }
  return null;
}

export const AUTOMATION_TIMEZONE = APP_TIMEZONE;
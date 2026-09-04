/**
 * Regra dos 5 minutos — janela mínima de agendamento.
 *
 * O worker `meta-publish-scheduled` roda a cada 1 minuto e reclama itens com
 * `scheduled_at <= now()`. Agendar para "agora" (ou para o passado) faz o item
 * ser publicado em uma janela imprevisível e impede qualquer correção. Por isso
 * TODA escrita de horário de agendamento passa por esta regra única.
 *
 * Exceções deliberadas (não usam esta função):
 *  - "Publicar agora": publicação direta e síncrona, sem fila.
 *  - Republicação de destino com falha: enfileira com `scheduled_at = now()`
 *    porque o usuário pediu a retentativa imediatamente.
 */

export const MIN_SCHEDULE_LEAD_MINUTES = 5;
export const MIN_SCHEDULE_LEAD_MS = MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000;

export const MIN_SCHEDULE_LEAD_MESSAGE = `Agende para pelo menos ${MIN_SCHEDULE_LEAD_MINUTES} minutos a partir de agora.`;

/** Primeiro instante válido para um agendamento. */
export function earliestScheduleDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + MIN_SCHEDULE_LEAD_MS);
}

/** O horário respeita a janela mínima? */
export function isScheduleLeadValid(value: string | Date, now: Date = new Date()): boolean {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= now.getTime() + MIN_SCHEDULE_LEAD_MS;
}

/** Lança com mensagem padrão quando o horário viola a janela mínima. */
export function assertScheduleLead(value: string | Date, now: Date = new Date()): void {
  if (!isScheduleLeadValid(value, now)) throw new Error(MIN_SCHEDULE_LEAD_MESSAGE);
}

/** "YYYY-MM-DD" local do primeiro dia válido (para `min` do input date). */
export function earliestScheduleDateInput(now: Date = new Date()): string {
  const d = earliestScheduleDate(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * "HH:MM" mínimo para o input de hora quando a data escolhida é o primeiro dia
 * válido; `undefined` para datas futuras (qualquer hora serve).
 */
export function earliestScheduleTimeInput(
  dateInput: string,
  now: Date = new Date(),
): string | undefined {
  if (!dateInput || dateInput !== earliestScheduleDateInput(now)) return undefined;
  const d = earliestScheduleDate(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

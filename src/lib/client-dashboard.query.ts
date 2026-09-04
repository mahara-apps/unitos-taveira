import type { DateRange } from "react-day-picker";
import { dayRangeKey, normalizedRangeIso } from "@/lib/range-key";
import { lastNDays } from "@/lib/date-range";

/**
 * Chave canônica do painel da conta — compartilhada pela tela e pelo prefetch do
 * seletor de clientes. Isolamento absoluto: `userId + brandId + clientId + período`.
 * O período usa precisão de dia para que a chave seja estável e reaproveitável.
 */
export function clientDashboardQueryKey(
  userId: string | null,
  brandId: string,
  clientId: string,
  range: DateRange | undefined,
): readonly unknown[] {
  return ["client-account-dashboard", userId ?? "anon", brandId, clientId, dayRangeKey(range)];
}

export function clientDashboardInput(
  brandId: string,
  clientId: string,
  range: DateRange | undefined,
): { brandId: string; clientId: string; range?: { from: string; to: string } } {
  const normalized = normalizedRangeIso(range);
  return normalized ? { brandId, clientId, range: normalized } : { brandId, clientId };
}

/** Período padrão do painel (últimos 30 dias, inclusivo) — prefetch do seletor. */
export function defaultDashboardRange(): DateRange {
  return lastNDays(30);
}

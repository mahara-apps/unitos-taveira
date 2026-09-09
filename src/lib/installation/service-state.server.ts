import type { ServiceState } from "@/lib/service-state";

/**
 * SQL que grava o estado operacional no banco do ambiente do cliente.
 *
 * Tolerante a instalação antiga (sem as colunas): cria as colunas se faltarem
 * antes de gravar, para o aviso funcionar mesmo antes da atualização completa.
 * Escapamos os textos aqui porque a Management API recebe SQL puro.
 */
function quote(value: string | null): string {
  if (value === null) return "null";
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildServiceStateSql(input: {
  state: ServiceState;
  message: string | null;
  untilIso: string | null;
  actor: string | null;
}): string {
  return `
alter table if exists public.installation
  add column if not exists service_state text not null default 'active',
  add column if not exists service_message text,
  add column if not exists service_until timestamptz,
  add column if not exists service_changed_at timestamptz,
  add column if not exists service_changed_by text;

update public.installation set
  service_state = ${quote(input.state)},
  service_message = ${quote(input.message)},
  service_until = ${input.untilIso ? `${quote(input.untilIso)}::timestamptz` : "null"},
  service_changed_at = now(),
  service_changed_by = ${quote(input.actor)};
`.trim();
}

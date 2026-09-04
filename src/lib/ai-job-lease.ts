/**
 * Regras puras de lease/TTL dos jobs de IA (`ai_jobs`).
 *
 * Espelham 1:1 a lógica SQL de `public.ai_job_lease_ttl`,
 * `public.ai_job_claim_lease`, `public.ai_job_heartbeat` e
 * `public.reap_stuck_ai_jobs`, para que servidor, UI e testes usem o MESMO
 * critério: um job só é considerado morto quando a lease expira de fato
 * (ou, na ausência de lease, quando o TTL do seu tipo é estourado).
 */

export const ACTIVE_JOB_STATUSES = ["queued", "running"] as const;

/** TTL de fallback por tipo de job, para jobs sem lease registrada. */
export const JOB_TTL_MS: Record<string, number> = {
  monthly_plan: 12 * 60_000,
  customer_strategy: 15 * 60_000,
};

export const DEFAULT_JOB_TTL_MS = 5 * 60_000;

export function jobTtlMs(kind: string): number {
  return JOB_TTL_MS[kind] ?? DEFAULT_JOB_TTL_MS;
}

export type LeaseJob = {
  kind: string;
  status: string;
  updated_at: string;
  heartbeat_at?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
};

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}

/** Lease ainda válida => o job está legitimamente em execução. */
export function isLeaseValid(job: LeaseJob, now: number = Date.now()): boolean {
  if (!isActiveStatus(job.status)) return false;
  const expires = ms(job.lease_expires_at);
  if (expires !== null) return expires > now;
  const last = ms(job.heartbeat_at) ?? ms(job.updated_at) ?? 0;
  return now - last < jobTtlMs(job.kind);
}

/** Critério do reaper: encerrar SOMENTE jobs ativos cuja validade acabou. */
export function shouldReapJob(job: LeaseJob, now: number = Date.now()): boolean {
  return isActiveStatus(job.status) && !isLeaseValid(job, now);
}

/**
 * Um novo worker só pode assumir o job se ele for o dono atual ou se a lease
 * não estiver mais válida (CAS equivalente ao `ai_job_claim_lease`).
 */
export function canClaimLease(job: LeaseJob, owner: string, now: number = Date.now()): boolean {
  if (!isActiveStatus(job.status)) return false;
  if (job.lease_owner && job.lease_owner === owner) return true;
  return !isLeaseValid(job, now);
}

export function leaseExpiryIso(leaseSeconds: number, now: number = Date.now()): string {
  return new Date(now + Math.max(leaseSeconds, 10) * 1000).toISOString();
}

export function newLeaseOwner(prefix = "job"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

import { queryOptions } from "@tanstack/react-query";
import {
  loadCustomerCoreFn,
  loadCustomerTargetFn,
  loadCustomerMarketFn,
  listCustomerPautasFn,
} from "./ai-agents.functions";

// Query options centralizados para a rota /customers/$customerId.
// Cada fatia tem sua própria queryKey e é resolvida em paralelo pelo
// TanStack Query, alimentando um Suspense boundary por aba.

type Scope = { brandId: string; clientId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isValidScope = (s: Partial<Scope> | null | undefined): s is Scope =>
  !!s &&
  typeof s.brandId === "string" &&
  typeof s.clientId === "string" &&
  UUID_RE.test(s.brandId) &&
  UUID_RE.test(s.clientId);

export const customerCoreQuery = ({ brandId, clientId }: Scope) =>
  queryOptions({
    queryKey: ["customer-core", brandId, clientId] as const,
    queryFn: () => loadCustomerCoreFn({ data: { brandId, clientId } }),
    staleTime: 30_000,
    enabled: isValidScope({ brandId, clientId }),
  });

export const customerTargetQuery = ({ brandId, clientId }: Scope) =>
  queryOptions({
    queryKey: ["customer-target", brandId, clientId] as const,
    queryFn: () => loadCustomerTargetFn({ data: { brandId, clientId } }),
    staleTime: 60_000,
    enabled: isValidScope({ brandId, clientId }),
  });

export const customerMarketQuery = ({ brandId, clientId }: Scope) =>
  queryOptions({
    queryKey: ["customer-market", brandId, clientId] as const,
    queryFn: () => loadCustomerMarketFn({ data: { brandId, clientId } }),
    staleTime: 60_000,
    enabled: isValidScope({ brandId, clientId }),
  });

export const customerPautasQuery = ({ brandId, clientId }: Scope) =>
  queryOptions({
    queryKey: ["customer-pautas", brandId, clientId] as const,
    queryFn: () => listCustomerPautasFn({ data: { brandId, clientId } }),
    staleTime: 30_000,
    enabled: isValidScope({ brandId, clientId }),
  });

export const CUSTOMER_QUERY_KEYS = {
  core: (s: Scope) => ["customer-core", s.brandId, s.clientId] as const,
  target: (s: Scope) => ["customer-target", s.brandId, s.clientId] as const,
  market: (s: Scope) => ["customer-market", s.brandId, s.clientId] as const,
  pautas: (s: Scope) => ["customer-pautas", s.brandId, s.clientId] as const,
  // Legacy — mantido para o hook em agent-tabs.tsx que ainda usa o loader unificado.
  legacyContext: (s: Scope) => ["client-ai-context", s.brandId, s.clientId] as const,
};

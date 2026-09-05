import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  getPortalMetricsFn,
  listPortalApprovalsFn,
  getPortalPostFn,
  decidePortalApprovalFn,
  listPortalCalendarFn,
  listPortalFilesFn,
  listPortalBriefingsFn,
} from "@/lib/portal-public.functions";
import {
  getPortalSessionMetricsFn,
  listPortalSessionApprovalsFn,
  getPortalSessionPostFn,
  decidePortalSessionApprovalFn,
  listPortalSessionCalendarFn,
  listPortalSessionFilesFn,
  listPortalSessionBriefingsFn,
  getPortalSessionPermissionsFn,
} from "@/lib/portal-session.functions";
import {
  listPortalBriefingRequestsFn,
  submitPortalBriefingProposalFn,
  listPortalSessionBriefingRequestsFn,
  submitPortalSessionBriefingProposalFn,
} from "@/lib/portal-briefing.functions";
import {
  listPortalScheduleFn,
  decidePortalScheduleFn,
  listPortalSessionScheduleFn,
  decidePortalSessionScheduleFn,
} from "@/lib/portal-schedule.functions";
import { getPortalBrandHubFn, getPortalSessionBrandHubFn } from "@/lib/portal-brand.functions";
import {
  listPortalPlansFn,
  getPortalPlanFn,
  decidePortalPlanFn,
  listPortalSessionPlansFn,
  getPortalSessionPlanFn,
  decidePortalSessionPlanFn,
} from "@/lib/portal-pauta.functions";
import { sessionTabPath, tokenTabRoute, type PortalTabId } from "./portal-nav";
import {
  DEFAULT_PORTAL_PERMISSIONS,
  normalizePortalPermissions,
  portalCanInteract,
  PORTAL_MODULES,
  type PortalPermissions,
} from "@/lib/portal-permissions";

/**
 * Camada única de dados do Portal do Cliente.
 *
 * O portal autenticado (`/area/*`) é a experiência principal e o link por token
 * (`/portal/$token/*`) segue como convite/fallback. As telas são as mesmas: elas
 * consomem `usePortalApi()` e nunca sabem qual modo está ativo. Cada operação
 * existe uma única vez no servidor por modo e ambas chamam as mesmas RPCs
 * `public.portal_*` / o mesmo núcleo de decisão de pauta.
 */

export type PortalMode = { kind: "token"; token: string } | { kind: "session"; clientId: string };

/**
 * Não existe modo "sessão sem cliente": o cliente do contexto é obrigatório e
 * resolvido/validado antes de montar o provider. Sem provider, qualquer consulta
 * falha explicitamente em vez de cair em outro cliente.
 */
const ModeContext = createContext<PortalMode | null>(null);

export function PortalModeProvider({
  value,
  children,
}: {
  value: PortalMode;
  children: ReactNode;
}) {
  return (
    <ModeContext.Provider value={value}>
      <PortalCapabilities>{children}</PortalCapabilities>
    </ModeContext.Provider>
  );
}

/* --------------------------- capacidades do modo -------------------------- */

type PortalCaps = { permissions: PortalPermissions; readOnly: boolean };
const CapsContext = createContext<PortalCaps | null>(null);

/**
 * Permissões efetivas do cliente + modo somente leitura.
 *
 * Login: vem de `portal_permissions` (mesma fonte usada no servidor).
 * Link sem senha: tudo apenas visível — nenhuma decisão é aceita no servidor.
 */
function PortalCapabilities({ children }: { children: ReactNode }) {
  const mode = usePortalMode();
  const loadPerms = useServerFn(getPortalSessionPermissionsFn);
  const permsQ = useQuery({
    queryKey: ["portal", "permissions", portalScopeKey(mode)],
    queryFn: () => loadPerms({ data: { clientId: (mode as { clientId: string }).clientId } }),
    enabled: mode.kind === "session",
    staleTime: 5 * 60_000,
  });

  const value = useMemo<PortalCaps>(() => {
    if (mode.kind === "token") {
      return {
        permissions: Object.fromEntries(
          PORTAL_MODULES.map((m) => [m.id, "view"]),
        ) as PortalPermissions,
        readOnly: true,
      };
    }
    return {
      permissions: normalizePortalPermissions(permsQ.data ?? DEFAULT_PORTAL_PERMISSIONS),
      readOnly: false,
    };
  }, [mode.kind, permsQ.data]);

  return <CapsContext.Provider value={value}>{children}</CapsContext.Provider>;
}

export function usePortalCaps(): PortalCaps {
  return (
    useContext(CapsContext) ?? { permissions: DEFAULT_PORTAL_PERMISSIONS, readOnly: false }
  );
}

export function usePortalMode(): PortalMode {
  const mode = useContext(ModeContext);
  if (!mode) throw new Error("portal_context_missing");
  return mode;
}

/** Chave estável para o react-query, isolando cliente/token. */
export function portalScopeKey(mode: PortalMode): string {
  return mode.kind === "token" ? `t:${mode.token}` : `s:${mode.clientId}`;
}

type ApprovalStatus = "all" | "pending" | "approved" | "adjust";
type PostDecision = "approved" | "rejected" | "adjust" | "comment";
type PlanDecision = "approve" | "reject" | "changes" | "per_item";
type PlanItems = Array<{
  topicId: string;
  decision: "approved" | "rejected" | "changes";
  comment: string;
}>;

export function usePortalApi() {
  const mode = usePortalMode();

  const tMetrics = useServerFn(getPortalMetricsFn);
  const tApprovals = useServerFn(listPortalApprovalsFn);
  const tPost = useServerFn(getPortalPostFn);
  const tDecide = useServerFn(decidePortalApprovalFn);
  const tCalendar = useServerFn(listPortalCalendarFn);
  const tFiles = useServerFn(listPortalFilesFn);
  const tBriefings = useServerFn(listPortalBriefingsFn);
  const tBriefingRequests = useServerFn(listPortalBriefingRequestsFn);
  const tSubmitBriefing = useServerFn(submitPortalBriefingProposalFn);
  const tPlans = useServerFn(listPortalPlansFn);
  const tPlan = useServerFn(getPortalPlanFn);
  const tDecidePlan = useServerFn(decidePortalPlanFn);
  const tBrandHub = useServerFn(getPortalBrandHubFn);
  const tSchedule = useServerFn(listPortalScheduleFn);
  const tDecideSchedule = useServerFn(decidePortalScheduleFn);

  const sMetrics = useServerFn(getPortalSessionMetricsFn);
  const sApprovals = useServerFn(listPortalSessionApprovalsFn);
  const sPost = useServerFn(getPortalSessionPostFn);
  const sDecide = useServerFn(decidePortalSessionApprovalFn);
  const sCalendar = useServerFn(listPortalSessionCalendarFn);
  const sFiles = useServerFn(listPortalSessionFilesFn);
  const sBriefings = useServerFn(listPortalSessionBriefingsFn);
  const sBriefingRequests = useServerFn(listPortalSessionBriefingRequestsFn);
  const sSubmitBriefing = useServerFn(submitPortalSessionBriefingProposalFn);
  const sPlans = useServerFn(listPortalSessionPlansFn);
  const sPlan = useServerFn(getPortalSessionPlanFn);
  const sDecidePlan = useServerFn(decidePortalSessionPlanFn);
  const sBrandHub = useServerFn(getPortalSessionBrandHubFn);
  const sSchedule = useServerFn(listPortalSessionScheduleFn);
  const sDecideSchedule = useServerFn(decidePortalSessionScheduleFn);

  return useMemo(() => {
    const isToken = mode.kind === "token";
    const token = mode.kind === "token" ? mode.token : "";
    // Modo sessão SEMPRE viaja com o cliente do contexto: nunca vazio/omitido.
    const base = { clientId: mode.kind === "session" ? mode.clientId : "" };

    return {
      isToken,
      scopeKey: portalScopeKey(mode),
      metrics: () => (isToken ? tMetrics({ data: { token } }) : sMetrics({ data: base })),
      approvals: (status: ApprovalStatus) =>
        isToken
          ? tApprovals({ data: { token, status } })
          : sApprovals({ data: { ...base, status } }),
      post: (postId: string) =>
        isToken ? tPost({ data: { token, postId } }) : sPost({ data: { ...base, postId } }),
      decidePost: (input: { postId: string; decision: PostDecision; note?: string }) =>
        isToken
          ? tDecide({ data: { token, ...input } })
          : sDecide({
              data: { ...base, postId: input.postId, decision: input.decision, note: input.note },
            }),
      calendar: (month: string) =>
        isToken ? tCalendar({ data: { token, month } }) : sCalendar({ data: { ...base, month } }),
      files: (search: string) =>
        isToken ? tFiles({ data: { token, search } }) : sFiles({ data: { ...base, search } }),
      briefings: () => (isToken ? tBriefings({ data: { token } }) : sBriefings({ data: base })),
      briefingRequests: () =>
        isToken ? tBriefingRequests({ data: { token } }) : sBriefingRequests({ data: base }),
      submitBriefing: (input: {
        requestId: string;
        answers: Record<string, string | string[]>;
        note?: string;
        attachments?: Array<{ name: string; mime?: string | null; dataBase64: string }>;
      }) =>
        isToken
          ? tSubmitBriefing({ data: { token, ...input } })
          : sSubmitBriefing({ data: { ...base, ...input } }),
      plans: () => (isToken ? tPlans({ data: { token } }) : sPlans({ data: base })),
      plan: (planId: string) =>
        isToken ? tPlan({ data: { token, planId } }) : sPlan({ data: { ...base, planId } }),
      decidePlan: (input: {
        planId: string;
        decision: PlanDecision;
        feedback?: string;
        items?: PlanItems;
      }) =>
        isToken
          ? tDecidePlan({ data: { token, ...input } })
          : sDecidePlan({ data: { ...base, ...input } }),
      brandHub: () => (isToken ? tBrandHub({ data: { token } }) : sBrandHub({ data: base })),
      /** Datas propostas para o cliente confirmar (não publica nada). */
      schedule: (from: string, to: string) =>
        isToken
          ? tSchedule({ data: { token, from, to } })
          : sSchedule({ data: { ...base, from, to } }),
      decideSchedule: (input: {
        postIds: string[];
        decision: "approve" | "changes";
        comment?: string;
      }) =>
        isToken
          ? tDecideSchedule({ data: { token, ...input } })
          : sDecideSchedule({ data: { ...base, ...input } }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, mode.kind === "token" ? mode.token : mode.clientId]);
}

/* ------------------------------- navegação -------------------------------- */

/** Path da aba no modo ativo — usado por navegação e detecção de aba ativa. */
export function usePortalPath(tab: PortalTabId): string {
  const mode = usePortalMode();
  return mode.kind === "token"
    ? tokenTabRoute(tab).replace("$token", mode.token)
    : sessionTabPath(tab);
}

/** Link interno agnóstico de modo. */
export function PortalLink({
  tab,
  className,
  children,
  current,
  "aria-label": ariaLabel,
}: {
  tab: PortalTabId;
  className?: string;
  children: ReactNode;
  /** Marca o link como página atual (navegação do shell). */
  current?: boolean;
  "aria-label"?: string;
}) {
  const mode = usePortalMode();
  const shared = {
    className,
    "aria-current": current ? ("page" as const) : undefined,
    "aria-label": ariaLabel,
  };
  if (mode.kind === "token") {
    return (
      <Link to={tokenTabRoute(tab) as "/portal/$token"} params={{ token: mode.token }} {...shared}>
        {children}
      </Link>
    );
  }
  return (
    <Link
      to={sessionTabPath(tab) as "/area/inicio"}
      search={{ cliente: mode.clientId }}
      {...shared}
    >
      {children}
    </Link>
  );
}

/** O cliente pode agir neste módulo? Link sem senha nunca pode. */
export function usePortalCanInteract(id: PortalTabId): boolean {
  const { permissions, readOnly } = usePortalCaps();
  if (readOnly) return false;
  return portalCanInteract(permissions, id as never);
}

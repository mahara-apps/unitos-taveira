import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { MonthlyPlanView } from "@/components/monthly-plan/monthly-plan-view";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useActiveContext } from "@/hooks/use-active-context";
import { useAccessRole } from "@/hooks/use-access-role";
import { FALLBACK_ROUTE } from "@/lib/permissions";
import { toast } from "sonner";
import { listClients } from "@/lib/workspace.functions";
import { StrategyResults } from "@/components/ai-agents/strategy-results";
import { CustomerOverview } from "@/components/customer/overview/customer-overview";
import { CustomerHeader } from "@/components/customer/customer-header";
import { PanelGroup } from "@/components/customer/ui/panel-section";
import { WorkTab } from "@/components/customer/work/work-tab";
import { PublicationsTab } from "@/components/customer/publications/publications-tab";
import { BasicInfoTab } from "@/components/customer/basic-info-tab";
import { AccountManagementTab } from "@/components/customer/account-management-tab";
import { BriefingWorkspace } from "@/components/brand-hub/briefing-workspace";
import { QuickOnboardingWizard } from "@/components/brand-hub/quick-onboarding-wizard";
import { getBrandHub } from "@/lib/brand-hub.functions";
import { computeBriefingCompletion } from "@/lib/briefing-progress";
import { usePageHeader } from "@/hooks/use-page-header";
import {
  CUSTOMER_TABS,
  CUSTOMER_TAB_SEARCH_VALUES,
  isCustomerTabAlias,
  resolveCustomerTab,
  type CustomerTab,
} from "@/lib/customer-tabs";
import {
  CUSTOMER_QUERY_KEYS,
  customerCoreQuery,
  customerMarketQuery,
  customerPautasQuery,
  customerTargetQuery,
} from "@/lib/customer-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

export const Route = createFileRoute("/_authenticated/customers/$customerId")({
  validateSearch: (s) =>
    z
      .object({
        onboarding: z.union([z.literal("1"), z.literal(1), z.boolean()]).optional(),
        planId: z.string().uuid().optional(),
        // Aceita as 6 abas canônicas + aliases legados (normalizados no guard).
        tab: z.enum(CUSTOMER_TAB_SEARCH_VALUES).optional(),
      })
      .parse(s),
  // Guard de rota: valida o customerId e normaliza a aba ANTES de montar
  // qualquer conteúdo protegido. A autorização definitiva continua na RLS
  // (server functions) — este guard é apenas de rota/navegação.
  beforeLoad: ({ params, search }) => {
    if (!isUuid(params.customerId)) {
      throw redirect({ to: "/customers", replace: true });
    }
    if (isCustomerTabAlias(search.tab)) {
      throw redirect({
        to: "/customers/$customerId",
        params: { customerId: params.customerId },
        search: { ...search, tab: resolveCustomerTab(search.tab) },
        replace: true,
      });
    }
  },
  component: CustomerDetail,
});

function CustomerDetail() {
  const { customerId } = Route.useParams();
  const { onboarding, tab, planId } = Route.useSearch();
  const { brandId, setClientId } = useActiveContext();
  const { role, allowedClientIds, isReady } = useAccessRole();
  const navigate = useNavigate();

  // O escopo do painel é sempre o `customerId` validado da rota — nunca o
  // clientId "ambiente". Só espelhamos no contexto ativo quando o acesso já
  // foi confirmado (efeito abaixo, após a checagem de responsabilidade).
  const outOfScope = isReady && !!allowedClientIds && !allowedClientIds.has(customerId);

  // Fase 4 — URL com clientId de OUTRO workspace: admin/super admin têm escopo
  // `null` (todos os clientes do workspace ativo), então a checagem por escopo
  // não basta. Validamos que o cliente pertence ao workspace ativo. A lista
  // passa pela RLS de `clients` (mesma chave de cache do header).
  const listForGuard = useServerFn(listClients);
  const brandClientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => listForGuard({ data: { brandId: brandId! } }),
    enabled: isUuid(brandId),
    staleTime: 60_000,
  });
  const crossWorkspace =
    !!brandClientsQ.data && !brandClientsQ.data.some((c) => c.id === customerId);

  const denied = outOfScope || crossWorkspace;
  const allowed = isReady && !denied && !!brandClientsQ.data && isUuid(customerId);

  useEffect(() => {
    if (allowed) setClientId(customerId);
  }, [allowed, customerId, setClientId]);

  useEffect(() => {
    if (!denied) return;
    toast.error("Acesso negado", {
      description: crossWorkspace
        ? "Este cliente não pertence ao workspace ativo."
        : "Você não é responsável por este cliente.",
    });
    navigate({ to: FALLBACK_ROUTE[role], replace: true });
  }, [denied, crossWorkspace, role, navigate]);

  if (!isUuid(brandId)) {
    return (
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
          Selecione um workspace no menu lateral.
        </div>
      </div>
    );
  }
  // Nada de dado protegido é montado antes da validação de escopo terminar
  // (papel/escopo + pertencimento do cliente ao workspace ativo).
  if (!isReady || !brandClientsQ.data) return <HeaderFallback />;
  if (denied) {
    return (
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          Você não é responsável por este cliente. Redirecionando…
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<HeaderFallback />}>
      <CustomerDetailReady
        brandId={brandId}
        customerId={customerId}
        openOnboarding={!!onboarding}
        initialTab={tab}
        initialPlanId={planId}
      />
    </Suspense>
  );
}

function HeaderFallback() {
  return (
    <ScrollArea className="h-[calc(100dvh-3.5rem)] bg-background">
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-32 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </header>
        <div className="rounded-lg border border-border/60 bg-card p-1">
          <div className="flex gap-2 p-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-md" />
            ))}
          </div>
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </ScrollArea>
  );
}

function CustomerDetailReady({
  brandId,
  customerId,
  openOnboarding,
  initialTab,
  initialPlanId,
}: {
  brandId: string;
  customerId: string;
  openOnboarding: boolean;
  initialTab?: string;
  initialPlanId?: string;
}) {
  const list = useServerFn(listClients);
  const fetchHub = useServerFn(getBrandHub);
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<CustomerTab>(resolveCustomerTab(initialTab));
  const [wizardOpen, setWizardOpen] = useState(false);
  const [planId, setPlanIdState] = useState<string | null>(initialPlanId ?? null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Sincroniza com ?tab=... (links internos como "Editar em Cadastro").
  useEffect(() => {
    if (initialTab) setActiveTab(resolveCustomerTab(initialTab));
  }, [initialTab]);

  // Troca de aba mantém a URL compartilhável (?tab=...).
  const goToTab = (value: string) => {
    const next = resolveCustomerTab(value);
    setActiveTab(next);
    navigate({
      to: "/customers/$customerId",
      params: { customerId },
      search: { tab: next, ...(next === "pauta" && planId ? { planId } : {}) } as never,
      replace: true,
    });
  };

  const setPlanId = (id: string | null) => {
    setPlanIdState(id);
    navigate({
      to: "/customers/$customerId",
      params: { customerId },
      search: { tab: "pauta", ...(id ? { planId: id } : {}) } as never,
      replace: true,
    });
  };

  // Lista de customers do brand ativo — só para nome/cor do header.
  const customersQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => list({ data: { brandId } }),
    staleTime: 60_000,
  });

  // Core suspende (rápido: briefing + voice + usage 30d em paralelo) — apenas para
  // pré-aquecer o cache das outras abas e alimentar o dashboard.
  useSuspenseQuery(customerCoreQuery({ brandId, clientId: customerId }));

  // Prefetch das fatias pesadas em paralelo assim que a rota monta —
  // elimina waterfall quando o usuário troca de aba.
  useEffect(() => {
    qc.prefetchQuery(customerTargetQuery({ brandId, clientId: customerId }));
    qc.prefetchQuery(customerMarketQuery({ brandId, clientId: customerId }));
    qc.prefetchQuery(customerPautasQuery({ brandId, clientId: customerId }));
  }, [qc, brandId, customerId]);

  const customer = (customersQ.data ?? []).find((c) => c.id === customerId);

  const hubQ = useQuery({
    queryKey: ["brand-hub", brandId, customerId],
    queryFn: () => fetchHub({ data: { brandId, clientId: customerId } }),
    staleTime: 30_000,
  });
  const completion = hubQ.data
    ? computeBriefingCompletion(hubQ.data.brand_hub ?? {}, hubQ.data)
    : 0;
  const needsOnboarding = !!hubQ.data && completion < 60;

  // Auto-open when the customer was just created (?onboarding=1).
  useEffect(() => {
    if (openOnboarding) {
      setWizardOpen(true);
      setActiveTab("briefing");
      // Clear the query param so a manual refresh doesn't reopen it.
      navigate({
        to: "/customers/$customerId",
        params: { customerId },
        search: {},
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOnboarding, customerId]);

  // Troca de aba interna acontece por prop (`onOpenTab`) ou por `?tab=` na URL —
  // não existe mais ponte global via window/CustomEvent.

  usePageHeader(
    {
      title: customer?.name ?? (customersQ.isLoading ? "Carregando…" : "Cliente"),
      subtitle: customer?.niche ?? "—",
    },
    [customer?.name, customer?.niche, customerId],
  );

  const scope = { brandId, clientId: customerId };
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEYS.core(scope) });
    qc.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEYS.target(scope) });
    qc.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEYS.market(scope) });
    qc.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEYS.pautas(scope) });
    qc.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEYS.legacyContext(scope) });
  };

  // Sub-rotas do painel (ex.: /media-plan) renderizam sozinhas.
  const isChildRoute = pathname.replace(/\/+$/, "") !== `/customers/${customerId}`;
  if (isChildRoute) return <Outlet />;

  return (
    <ScrollArea className="h-[calc(100dvh-3.5rem)] bg-background">
      <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {customer === undefined && !customersQ.isLoading ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Este cliente não pertence ao workspace ativo.
          </div>
        ) : (
          <>
            <CustomerHeader
              name={customer?.name ?? (customersQ.isLoading ? "Carregando…" : "Cliente")}
              niche={customer?.niche}
              color={customer?.color}
              isActive={customer?.is_active}
              briefingCompletion={hubQ.data ? completion : null}
              actions={
                needsOnboarding ? (
                  <Button
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => {
                      goToTab("briefing");
                      setWizardOpen(true);
                    }}
                  >
                    <Sparkles className="h-4 w-4" />
                    Completar briefing
                  </Button>
                ) : null
              }
            />

            <Tabs value={activeTab} onValueChange={goToTab} className="space-y-6">
              {/* Navegação horizontal rolável: nunca quebra em várias linhas. */}
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <TabsList className="w-max min-w-full flex-nowrap justify-start gap-1 rounded-xl bg-muted/40 p-1">
                  {CUSTOMER_TABS.map((t) => (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      className="h-9 shrink-0 gap-1.5 rounded-lg px-3.5 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
                    >
                      {t.label}
                      {t.value === "briefing" && needsOnboarding && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full bg-severity-warning"
                        />
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <TabsContent value="overview" className="mt-0">
                <CustomerOverview
                  brandId={brandId}
                  clientId={customerId}
                  onOpenBriefing={() => goToTab("briefing")}
                  onOpenTab={goToTab}
                />
              </TabsContent>

              <TabsContent value="briefing" className="mt-0 space-y-8">
                <BriefingWorkspace
                  brandId={brandId}
                  clientId={customerId}
                  embedded
                  layout="stacked"
                  onStrategyGenerated={() => {
                    invalidateAll();
                    qc.invalidateQueries({
                      queryKey: ["strategy-runs", brandId, customerId],
                    });
                  }}
                />
                {/* Estratégia IA vive junto do briefing que a gera (alias ?tab=estrategia). */}
                <PanelGroup
                  title="Estratégia gerada pela IA"
                  description="Resultados criados a partir do briefing acima."
                >
                  <StrategyResults
                    brandId={brandId}
                    clientId={customerId}
                    onGenerate={() => goToTab("briefing")}
                    onRestored={invalidateAll}
                  />
                </PanelGroup>
              </TabsContent>

              <TabsContent value="pauta" className="mt-0">
                <MonthlyPlanView
                  brandId={brandId}
                  clientId={customerId}
                  planId={planId}
                  onSelectPlan={setPlanId}
                  embedded
                />
              </TabsContent>

              <TabsContent value="trabalho" className="mt-0">
                <WorkTab brandId={brandId} clientId={customerId} />
              </TabsContent>

              {/* Aba única "Conta": cadastro (identidade/contato/redes) +
                  gestão (contrato/jornada). Cada informação tem uma só fonte. */}
              <TabsContent value="conta" className="mt-0 space-y-8">
                <PanelGroup
                  title="Dados da empresa e contatos"
                  description="Identidade, contato principal e redes sociais do cliente."
                >
                  <BasicInfoTab brandId={brandId} clientId={customerId} />
                </PanelGroup>
                <PanelGroup
                  title="Contrato, jornada e portal"
                  description="Situação comercial, etapa da jornada e acesso do cliente ao portal."
                >
                  <AccountManagementTab brandId={brandId} clientId={customerId} />
                </PanelGroup>
              </TabsContent>

              <TabsContent value="publicacoes" className="mt-0">
                <PublicationsTab brandId={brandId} clientId={customerId} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <QuickOnboardingWizard
        brandId={brandId}
        clientId={customerId}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onOpenFullBriefing={() => setActiveTab("briefing")}
      />
    </ScrollArea>
  );
}

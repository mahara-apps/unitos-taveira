import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronDown, Lightbulb, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { aiErrorMessage } from "@/lib/ai-error-display";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { cn } from "@/lib/utils";
import { regenerateMediaPlanStrategy } from "@/lib/media-plan-interview.functions";
import type { MediaPlan, MediaPlanItem } from "@/lib/media-plans.functions";

const STAGE_LABEL: Record<string, string> = {
  topo: "Descobrir a marca",
  meio: "Considerar a compra",
  fundo: "Comprar agora",
};

const currency = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

/**
 * Camada estratégica do plano gerado pela IA: resumo executivo, divisão da
 * jornada, avisos e as campanhas prontas para execução com roteiro de criativo.
 * Aparece somente quando o plano veio da entrevista guiada.
 */
export function PlanStrategyPanel({ plan, items }: { plan: MediaPlan; items: MediaPlanItem[] }) {
  const qc = useQueryClient();
  const regenFn = useServerFn(regenerateMediaPlanStrategy);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinement, setRefinement] = useState("");

  const strategy = plan.strategy ?? {};
  const regenMut = useMutation({
    mutationFn: () => regenFn({ data: { planId: plan.id, refinement: refinement.trim() || null } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["media-plan", plan.id] });
      setRefineOpen(false);
      setRefinement("");
      toast.success("Plano regerado com as novas instruções");
    },
    onError: (e: unknown) => toast.error(aiErrorMessage(e, "Não foi possível regerar o plano")),
  });

  const interviewSaved = Object.keys(plan.interview ?? {}).length > 0;
  if (!strategy.summary) return null;

  const split = strategy.funnel_split ?? { topo: 0, meio: 0, fundo: 0 };
  const campaigns = items.filter((i) => !!i.platform);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">Estratégia recomendada</div>
              <div className="text-xs text-muted-foreground">
                Versão {plan.plan_version ?? 1}
                {strategy.model ? ` · ${strategy.model}` : ""}
              </div>
            </div>
          </div>
          {interviewSaved && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefineOpen((v) => !v)}
              disabled={regenMut.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Refazer com ajustes
            </Button>
          )}
        </div>

        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{strategy.summary}</p>

        {refineOpen && (
          <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
            <Textarea
              rows={3}
              placeholder="O que você quer diferente? Ex.: foque mais no WhatsApp e tire o YouTube."
              value={refinement}
              onChange={(e) => setRefinement(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRefineOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => regenMut.mutate()} disabled={regenMut.isPending}>
                {regenMut.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Refazendo…
                  </>
                ) : (
                  "Refazer plano"
                )}
              </Button>
            </div>
          </div>
        )}

        <PageKpiGrid className="mt-4">
          {(["topo", "meio", "fundo"] as const).map((k) => (
            <PageKpi
              key={k}
              label={STAGE_LABEL[k]!}
              value={`${split[k] ?? 0}%`}
              description={currency(((split[k] ?? 0) / 100) * plan.monthly_budget)}
            />
          ))}
          <PageKpi
            label="Campanhas"
            value={String(campaigns.length)}
            description="prontas para subir"
          />
        </PageKpiGrid>

        {strategy.funnel_rationale && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {strategy.funnel_rationale}
          </p>
        )}
        {strategy.platform_split_rationale && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {strategy.platform_split_rationale}
          </p>
        )}
      </div>

      {(strategy.warnings ?? []).length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" /> Antes de subir as campanhas
          </div>
          <ul className="mt-2 space-y-1.5">
            {(strategy.warnings ?? []).map((w, i) => (
              <li key={i} className="text-sm text-muted-foreground">
                • {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Campanhas e roteiro de criativos
          </div>
          {campaigns.map((c) => (
            <CampaignCard key={c.id} item={c} monthlyBudget={plan.monthly_budget} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignCard({ item, monthlyBudget }: { item: MediaPlanItem; monthlyBudget: number }) {
  const [open, setOpen] = useState(false);
  const amount = (monthlyBudget * (Number(item.budget_pct) || 0)) / 100;
  const creative = item.creative_brief ?? {};

  return (
    <div className="rounded-2xl border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{item.product_service}</span>
            <Badge variant="secondary">{item.channel}</Badge>
            {item.funnel_stage && (
              <Badge variant="outline">{STAGE_LABEL[item.funnel_stage] ?? item.funnel_stage}</Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[item.campaign_type, item.campaign_subtype].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{currency(amount)}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {currency(item.daily_budget)} / dia
          </div>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Objetivo" value={item.objective} />
            <Info label="Otimizar para" value={item.optimization_goal} />
            <Info label="Evento de conversão" value={item.conversion_event} />
            <Info label="Métrica principal" value={item.main_kpi} />
            <Info label="Público" value={item.audience} />
            <Info label="Onde aparece" value={(item.placements ?? []).join(", ")} />
          </div>

          {item.targeting?.notes && <Info label="Segmentação" value={item.targeting.notes} />}

          {(item.keywords ?? []).length > 0 && (
            <ChipList label="Palavras-chave" values={item.keywords} />
          )}
          {(item.targeting?.negative_keywords ?? []).length > 0 && (
            <ChipList label="Palavras negativas" values={item.targeting!.negative_keywords!} />
          )}

          {(item.prerequisites ?? []).length > 0 && (
            <div>
              <Label>Precisa existir antes</Label>
              <ul className="mt-1 space-y-1">
                {item.prerequisites.map((p, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    • {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(item.estimates?.cpa_range || item.estimates?.volume_range) && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <Label>Expectativa (estimativa, não promessa)</Label>
              <div className="mt-1 text-sm">
                {[item.estimates?.cpa_range, item.estimates?.volume_range]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {item.estimates?.notes && (
                <p className="mt-1 text-xs text-muted-foreground">{item.estimates.notes}</p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border/60 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="h-4 w-4 text-amber-500" /> Roteiro de criativos
            </div>
            {(creative.angles ?? []).length > 0 && (
              <div className="mt-2">
                <Label>Ideias de abordagem</Label>
                <ul className="mt-1 space-y-1">
                  {creative.angles!.map((a, i) => (
                    <li key={i} className="text-sm text-muted-foreground">
                      • {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(creative.headlines ?? []).length > 0 && (
              <ChipList label="Títulos" values={creative.headlines!} />
            )}
            {(creative.descriptions ?? []).length > 0 && (
              <ChipList label="Descrições" values={creative.descriptions!} />
            )}
            {creative.cta && <Info label="Botão" value={creative.cta} />}
            {(creative.visual_ideas ?? []).length > 0 && (
              <div className="mt-2">
                <Label>Ideias de imagem/vídeo</Label>
                <ul className="mt-1 space-y-1">
                  {creative.visual_ideas!.map((v, i) => (
                    <li key={i} className="text-sm text-muted-foreground">
                      • {v}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {item.rationale && <Info label="Por que essa campanha" value={item.rationale} />}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="mt-2">
      <Label>{label}</Label>
      <div className="mt-0.5 whitespace-pre-line text-sm">{value}</div>
    </div>
  );
}

function ChipList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="mt-2">
      <Label>{label}</Label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span
            key={i}
            className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-xs"
          >
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

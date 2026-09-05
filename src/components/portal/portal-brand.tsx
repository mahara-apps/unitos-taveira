import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePortalApi } from "./portal-context";
import { EmptyState, ErrorState, ListSkeleton, formatDate } from "./portal-shared";
import { BRIEFING_BLOCKS, BRIEFING_FIELDS } from "@/lib/briefing-fields";

/**
 * FASE 7 — "Minha Marca" (somente leitura).
 *
 * Fonte única: `clients.brand_hub`, lido pelo fluxo já existente
 * (`api.brandHub()`). Nenhum campo inventado: só são exibidas chaves do
 * catálogo de briefing e alguns extras conhecidos do hub. Nada financeiro,
 * interno ou administrativo da agência aparece aqui.
 */

/** Campos do hub fora do catálogo de briefing que fazem sentido para o cliente. */
const EXTRA_FIELDS: Array<{ key: string; label: string; block: string }> = [
  { key: "tone_tags", label: "Palavras que traduzem a marca", block: "estetica" },
  { key: "inspirations", label: "Referências e inspirações", block: "estetica" },
];

const BLOCK_HINT: Record<string, string> = {
  identidade: "Quem a marca é.",
  produto: "O que a marca oferece.",
  publico: "Para quem a marca fala.",
  estetica: "Como a marca se comunica.",
  metas: "O que a marca quer alcançar.",
};

export function PortalBrand() {
  const api = usePortalApi();
  const q = useQuery({
    queryKey: ["portal", "brand-hub", api.scopeKey],
    queryFn: () => api.brandHub(),
    staleTime: 5 * 60_000,
  });

  if (q.isLoading) return <ListSkeleton />;
  if (q.isError)
    return (
      <ErrorState
        description="Não conseguimos carregar as informações da sua marca agora."
        message={(q.error as Error)?.message}
        onRetry={() => q.refetch()}
      />
    );

  const data = q.data;
  const hub = data?.hub ?? {};

  const blocks = BRIEFING_BLOCKS.map((b) => {
    const fields = [
      ...BRIEFING_FIELDS.filter((f) => f.block === b.id).map((f) => ({
        key: f.key,
        label: f.label,
      })),
      ...EXTRA_FIELDS.filter((f) => f.block === b.id).map((f) => ({ key: f.key, label: f.label })),
    ].filter((f) => (hub[f.key] ?? "").trim().length > 0);
    return { ...b, fields };
  }).filter((b) => b.fields.length > 0);

  const hasHeaderInfo = Boolean(data?.niche || data?.toneOfVoice);

  if (!blocks.length && !hasHeaderInfo)
    return (
      <EmptyState
        icon={FileText}
        title="Ainda não há informações da sua marca"
        description="Depois que você responder o briefing, as informações aprovadas aparecem aqui."
      />
    );

  return (
    <div className="space-y-5">
      <header className="space-y-2 rounded-xl border border-border/60 bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">
            {data?.clientName ?? "Sua marca"}
          </h2>
          {data?.niche ? (
            <Badge variant="secondary" className="text-[11px]">
              {data.niche}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Estas são as informações da sua marca que a equipe usa para criar os conteúdos. Para mudar
          algo, fale com a equipe ou responda um novo briefing.
          {data?.updatedAt ? ` Atualizado em ${formatDate(data.updatedAt)}.` : ""}
        </p>
        {data?.toneOfVoice ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Tom de voz: </span>
            {data.toneOfVoice}
          </p>
        ) : null}
      </header>

      {blocks.map((b) => (
        <section key={b.id} className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5 sm:px-5">
            <h2 className="text-sm font-semibold tracking-tight">{b.label}</h2>
            {BLOCK_HINT[b.id] ? (
              <span className="text-[11px] text-muted-foreground">{BLOCK_HINT[b.id]}</span>
            ) : null}
          </div>
          <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
            {b.fields.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {f.label}
                </dt>
                <dd className="mt-1 whitespace-pre-line text-sm">{hub[f.key]}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

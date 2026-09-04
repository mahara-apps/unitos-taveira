<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## KPIs

Todo KPI/resumo numerico deve usar `PageKpi`/`PageKpiGrid` (`src/components/ui/page-kpi.tsx`).
Nao criar componentes locais de KPI/Stat/Metric; legados devem ser adaptadores finos de `PageKpi`.
Ver DESIGN_SYSTEM.md secao 3.0.

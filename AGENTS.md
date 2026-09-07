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

## MASTER-first (regra obrigatoria)

Nenhuma alteracao do sistema esta concluida enquanto nao estiver no pacote que
o MASTER propaga para as demais instalacoes. Sequencia fixa, sem excecao:

1. Aplicar a alteracao no MASTER (migration/seed/codigo).
2. Regenerar o pacote: `python3 supabase/baseline-snapshot/tools/build_delta.py`.
3. Atualizar `supabase/baseline-snapshot/tools/delta_version.txt` (sha256 impresso
   pelo gerador + nova `version`) e `MASTER_RELEASE_VERSION` em
   `src/lib/installation/manager-contract.ts` com o MESMO valor.
4. Cobrir o que foi criado em `supabase/install/verify-installation.sql`
   (tabelas novas entram na checagem 80).
5. Rodar `bun run master:check` — reprova se pacote, versao ou relatorio de
   saude ficarem fora de sincronia.
6. Publicar o MASTER e autorizar "Atualizar" em cada instalacao.

Guardiao automatico: `tests/installation-master-sync.unit.test.ts` e
`tests/installation-baseline-completeness.unit.test.ts`.

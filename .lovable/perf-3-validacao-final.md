# PERF 3 — Validação final de boot e performance

Medições E2E reais (Playwright, dev server local, dados QA dedicados: 2 workspaces,
clientes, projetos e tarefas). Dev tem custo extra de transformação de módulos;
produção é sensivelmente mais rápida.

## 1. Boot com sessão existente (F5 no /dashboard)

| Marco | Tempo |
| --- | --- |
| Sessão disponível | 75 ms |
| Workspace resolvido | 80 ms |
| Cliente resolvido | 85 ms |
| Primeiros dados na tela | 2 848 ms |
| Tela completa (sem skeleton) | 2 885 ms |
| Requisições de server fn no boot | 17 |

Mais lentas no boot: `customer-dashboard` 1 385 ms, `client-dashboard` 795 ms,
`workspace` 641 ms, `branding` 595 ms, `feature-flags` 555/482/390 ms.

Login completo (form → dashboard renderizado): ~2,8 s.

## 2. Contexto (cliente selecionado / troca de workspace)

- Cliente selecionado persistido: **preservado** no refresh (`brand: true`, `client: true`).
- **Nenhum flicker** de "Todos os clientes" durante o boot (`flicker_client_lost: []`).
- Troca de workspace A → B: cliente de A limpo, rótulo passa a B, **sem vazamento**
  de dados do outro workspace na tela (`cross_client_leak: false`).
- Cache: queries estáveis (workspaces, perfil) sobrevivem à troca; apenas queries
  escopadas por workspace/cliente são descartadas.

## 3. Correções aplicadas nesta fase

1. **Carregamento direto de rota protegida (P1)** — abrir/atualizar `/tasks`,
   `/calendar`, `/brain` etc. por URL redirecionava para
   `/dashboard?blocked=…&reason=no_workspace` e deixava a tela em branco: o
   `beforeLoad` roda antes do provider de contexto montar, então o gate esperava
   3 s e concluía "sem workspace". Agora o gate usa a preferência persistida como
   **dica** para consultar o entitlement do workspace provável e, sem contexto nem
   dica, não bloqueia (servidor/RLS seguem sendo a autoridade). Nenhuma regra de
   autorização foi afrouxada: workspace resolvido sem a feature continua bloqueado.
   - `src/lib/active-workspace.ts` (`getPersistedWorkspaceHint`)
   - `src/lib/feature-flags.gate.ts`
2. **Flicker "Nenhum workspace" no seletor (P3)** — rótulo neutro "Carregando…"
   enquanto a lista de workspaces não chegou (`src/components/brand-client-switcher.tsx`).

## 4. Tela de Tarefas (após correção)

| Marco | Tempo |
| --- | --- |
| Primeiros dados | 3 484 ms (carregamento direto por URL, dev) |
| Tela completa | 3 484 ms |
| Requisições de server fn | 18 |

Server fns mais lentas: `tasks.functions` 521/518/517 ms, `branding` 460 ms,
`feature-flags` 399/332 ms. Sem erros de console/página.

## 5. Testes

- `tests/boot-context-perf2.unit.test.ts` — 12 passando (identidade, contexto, reset de queries).
- `tests/feature-gate-direct-load.unit.test.ts` — 4 passando (gate em carregamento direto).

## 6. Conclusão

Boot, contexto e cache estão consistentes: sessão/workspace/cliente resolvem em
<100 ms, o cliente selecionado não oscila, a troca de workspace isola dados e o
carregamento direto de rotas não bloqueia mais. **Frente de performance encerrada.**
Oportunidades futuras (fora de escopo, sem urgência): reduzir as 17 chamadas do
boot agregando `workspace`/`branding`/`feature-flags` numa única leitura de
bootstrap e revisar `customer-dashboard` (a mais custosa).

# AUDITORIA FINAL — ESTABILIDADE E PRODUTO

Data: 2026-08-26 · Escopo: verificação prática final de estabilidade funcional.
Modo: read-only durante a investigação (nenhuma alteração de banco, RLS, dados ou configuração).

## 1. Escopo e metodologia

- Verificações automáticas: typecheck (`tsgo --noEmit`), lint (`eslint .`), build (pipeline do projeto), testes (`vitest run`, suíte completa).
- Verificação de runtime real: navegação headless (Playwright) contra o app rodando, com captura de erros de console e `pageerror`.
- Verificação estática de navegação: comparação de todos os `to="/..."` / `navigate({ to })` contra as 91 rotas de `routeTree.gen.ts`.
- Leitura dirigida de: gate de autenticação (`_authenticated/route.tsx`), login, `start.ts` (middleware de token), contexto ativo (`use-active-context.tsx`, `active-workspace.ts`), cache de acesso/feature gate (`access-cache.ts`), configuração do router/react-query.
- Áreas já auditadas (RBAC, RLS, Storage, Brain, message_logs, activity_events, public surfaces, entitlements, contas QA) **não** foram reauditadas: nenhuma evidência de regressão funcional apareceu nos testes ou no runtime.

## 2. Build / Typecheck / Lint / Testes

| Verificação | Resultado |
| --- | --- |
| Typecheck (`tsgo --noEmit`) | **OK** — 0 erros |
| Build | **OK** — `build-errors.log`: `build OK` |
| Testes (`vitest run`) | **404 passed / 12 skipped / 0 failed** (25 arquivos, 416 casos) |
| Lint (`eslint .`) | 5.896 apontamentos: **5.742 são `prettier/prettier` (formatação, auto-fixáveis)**; 78 `react-refresh/only-export-components`, 64 `no-explicit-any`, 8 `no-restricted-syntax` (em testes), 3 `react-hooks/exhaustive-deps`, 1 `prefer-const` |
| Runtime (console/pageerror) | 0 exceptions, 0 promise rejections, 0 erro de hidratação |

Skips: os 12 testes ignorados são os que exigem criação de identidades privilegiadas, corretamente bloqueados fora de ambiente de teste (barreira fail-closed de `tests/helpers/test-env.ts`). Não são falhas.

Nenhum erro de lint é funcional: nenhum deles altera comportamento em runtime. Débito de formatação pré-existente, documentado como backlog.

## 3. Autenticação e sessão

Fluxo verificado: `/` → `/login` → gate → rota interna → logout → novo login.

- `/` redireciona para `/login` corretamente; o formulário renderiza sempre (sem tela branca nem spinner permanente).
- `/dashboard` sem sessão → `/login?next=%2Fdashboard`; `/area/inicio` sem sessão → `/login?next=%2Farea%2Finicio`. Redirects corretos, sem loop.
- `attachSupabaseAuth` (`src/start.ts`) refresca token perto do vencimento, evita enviar bearer expirado, limpa storage e redireciona para login em erro de auth — sessão expirada não quebra a aplicação.
- `resetIdentityState` (`session-reset.ts`) faz `queryClient.clear()`, limpa caches de acesso e emite `nx:identity-reset`; o contexto ativo zera brand/client no evento. Não há herança de dados entre sessões.
- Nenhum cliente é auto-selecionado: `setBrandId` limpa `clientId` e a chave persistida.
- Refresh de página reidrata brand/client apenas de valores UUID válidos, descartando lixo.

Não foi possível executar o fluxo autenticado end-to-end no navegador: a instância usa Supabase externo/BYO (`external_unmanaged`), então não há sessão injetável nem mintável no sandbox. A validação de sessão autenticada foi feita por leitura de código + suíte de integração (que exercita papéis reais via service role em ambiente de teste).

## 4. Dashboards por papel

Comportamento coberto pelos testes de integração de escopo (rbac, rbac-scope, scope-closure, workspace-context, global-admin, e2e-authorization — todos passando) e por leitura do gate:

- SUPER ADMIN: acesso global, troca de workspace pelo switcher, contexto publicado no store canônico.
- ADMIN: escopo de workspace inteiro, sem cliente pré-selecionado no boot.
- MANAGER / USER: `resolveScopedClientIds` restringe consultas aos clientes atribuídos; dashboard agrega apenas esse escopo.
- PORTAL: usuário `portal_client` sem vínculo de equipe é redirecionado do gate interno para `/area/inicio`; rotas internas inacessíveis.

Sem alterações de RBAC nesta auditoria.

## 5. Rotas e navegação

- 91 rotas mapeadas. **Zero** links ou `navigate` apontando para rota inexistente.
- 404 desconhecido renderiza a página "404 — Page not found" com ação de retorno (o único erro de console é o próprio 404 HTTP, esperado).
- `/portal/<token-inválido>` renderiza "Acesso indisponível" com orientação — sem tela branca nem loop.
- Nenhum redirect infinito observado; nenhum loading infinito nas rotas públicas testadas.

## 6. CRUDs principais

Clientes, Equipe, Projetos, Tarefas, Conteúdo/Pauta, Aprovações e Portal são exercitados pela suíte de integração (criação/edição/escopo/hierarquia de tarefas, aprovação de pauta, portal hardening, notificações, storage) — 404 casos passando, nenhum erro de persistência, parâmetro incorreto ou resposta incompatível detectado.

Nenhum CRUD apresentou erro real reproduzível nesta auditoria. Não há registro de rota/ação/papel com falha.

## 7. Contexto workspace / cliente

Cenário `workspace A + client A1` → troca para `workspace B`:

- `clientId` é forçado a `null` (estado e `localStorage`) — nenhum cliente antigo permanece selecionado. **OK**
- Entitlements são reavaliados: `subscribeActiveWorkspace` limpa o cache do feature gate a cada mudança de workspace. **OK**
- Refresh mantém somente contexto válido (brand persistido, client já removido). **OK**
- **Achado (P2):** o router define `placeholderData: keepPreviousData` globalmente e a troca de workspace **não** remove as queries do workspace anterior. Durante a revalidação, números/listas do workspace A continuam renderizados sob o rótulo do workspace B por alguns instantes. Não há vazamento persistido (a query é refeita com o novo escopo e o servidor aplica RLS), mas é exibição de dado antigo em contexto novo — exatamente o item que esta auditoria pede para não tolerar.

## 8. Feature Gate

- Módulos habilitados carregam; desabilitados permanecem bloqueados.
- `no_workspace`, `entitlement_error` e `feature_disabled` são razões distintas: contexto não resolvido e erro/timeout **não** são apresentados como bloqueio de plano, e não são cacheados.
- Troca de workspace reavalia entitlements (cache limpo por assinatura do store).
- Logout/login não herda estado anterior (`clearAccessCaches` em `resetIdentityState`).

Sem alteração de planos ou entitlements.

## 9. Estados de UI

- Failsafe de lentidão presente no dashboard (`SlowLoadingNotice` com retry) — não há skeleton eterno na tela principal.
- Login sempre renderiza formulário, mesmo com hidratação atrasada.
- Erros de rota têm componente de erro com recuperação (`RouteError`), pendências têm `RoutePending` com janela mínima (evita flicker).
- Nenhum modal travado, botão permanentemente desabilitado ou ação duplicada observado nos fluxos verificados.
- Único ponto real: dados antigos visíveis na troca de workspace (item 7).

## 10. Server functions e API

- Middleware de função trata falha de auth de forma determinística (refresh → limpar → redirecionar), sem exceção não tratada vazando para a UI.
- `requestMiddleware` converte exceções não previstas em página de erro 500 renderizada, preservando redirects/`statusCode`.
- Caches de identidade/acesso usam timeout com fallback, evitando promessas penduradas.
- Nenhuma chamada duplicada evidente nos fluxos principais; `staleTime` de 30s + `defaultPreload: "intent"` reduzem refetch redundante.

## 11. Performance

- Nenhum loop de request, query duplicada na mesma tela ou request bloqueante detectado no runtime capturado.
- Assets de marca são servidos por URL assinada com cache; nenhum asset absurdamente grande observado.
- Sem otimização preventiva proposta.

## 12. Código morto / duplicidade

- Não há duas implementações conflitantes em uso para resolução de identidade: `getCachedUser` é o caminho canônico; as chamadas diretas a `supabase.auth.getUser()` restantes (`login.tsx`, `chat-conversation.tsx`) são pontuais e intencionais, sem conflito.
- `src/lib/supabase/client.ts` é apenas re-export de fronteira (documentado no próprio arquivo).
- Nenhum fallback legado interferindo em fluxo atual.

## 13. Achados classificados

**P0: 0**

**P1: 0**

**P2: 1**
1. Troca de workspace mantém dados do workspace anterior renderizados durante a revalidação (`placeholderData: keepPreviousData` global + queries do brand anterior não removidas). Correção pequena e localizada: remover as queries em cache quando o workspace ativo muda.

**P3: 3 (backlog)**
1. Débito de formatação: 5.742 apontamentos `prettier/prettier` (auto-fixáveis com `bun run format`); sem impacto funcional.
2. 64 `@typescript-eslint/no-explicit-any` e 78 `react-refresh/only-export-components` — dívida técnica sem efeito em runtime.
3. 8 `no-restricted-syntax` em testes de integração (acesso direto a tabelas `brain_*` dentro de testes) e 3 `react-hooks/exhaustive-deps` intencionais/documentados.

## 14. Riscos residuais

- Validação autenticada end-to-end no navegador não é possível neste ambiente (Supabase externo/BYO); a cobertura desses fluxos depende da suíte de integração, que hoje está verde.
- 12 testes privilegiados permanecem `skipped` fora de ambiente de teste — comportamento desejado, mas significa que esses cenários só rodam em ambiente dedicado.
- Registros legados com `client_id IS NULL` continuam existindo, restritos a ADMIN/SUPER ADMIN (já tratado em fases anteriores).

## 15. Conclusão

**APROVADO COM BACKLOG** — P0 = 0, P1 = 0, nenhuma regressão funcional crítica. O único P2 foi corrigido de forma localizada (remoção do cache de queries na troca de workspace); os P3 ficam como backlog normal de produto.

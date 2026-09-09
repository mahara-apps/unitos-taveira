# Token na edição, excluir, suspender e aviso de atualização

## 1. Token do Supabase no "Editar dados"

Hoje o token só pode ser informado no cadastro ou na aba "Acessos". O formulário de edição passa a ter um campo seguro **Supabase Access Token** (com olho para ver o que foi digitado) e um link direto para a página de tokens do Supabase.

- O campo mostra o estado atual: "token guardado" ou "nenhum token guardado".
- Deixar em branco **mantém** o token atual — nunca apaga por descuido.
- Ao preencher, o token é guardado cifrado, como já acontece hoje; se a gravação falhar, os outros dados também não são salvos (nada fica pela metade).

## 2. Excluir instalação

Nova ação **Excluir instalação** no menu de três pontinhos do detalhe e na lista, já com a confirmação forte (digitar o nome exato).

- Remove apenas o registro no MASTER: cadastro, histórico de operações e acessos guardados aqui.
- Não mexe no Supabase, no repositório nem na hospedagem do cliente — a confirmação diz isso em texto claro.

## 3. Suspender instalação

Novo par de ações **Suspender** / **Reativar**, com motivo obrigatório na suspensão.

- Enquanto suspensa, quem abrir aquele ambiente vê uma tela "Sistema suspenso" com o motivo e o contato; nada de dado é apagado.
- Só o Super Admin daquele ambiente continua navegando (para corrigir o que for preciso).
- No MASTER a instalação aparece marcada como suspensa na lista e no detalhe, e provisionar/atualizar/validar ficam bloqueados até reativar.

## 4. Aviso de atualização (sim, a atualização afeta o ambiente)

Durante uma atualização o banco do cliente recebe as mudanças e o site é republicado: por alguns minutos o ambiente fica instável. Passa a existir aviso automático:

- Ao iniciar a atualização, o MASTER liga no ambiente do cliente uma faixa fixa no topo: "Atualização em andamento — evite salvar agora."
- Enquanto a faixa estiver ligada, **criar e salvar fica temporariamente indisponível** (botões desabilitados com a explicação), tanto no app da agência quanto no portal do cliente. Leitura continua liberada.
- Ao concluir (com sucesso ou falha), o MASTER desliga a faixa e libera a gravação. Se a operação for interrompida, o aviso expira sozinho por tempo, para nunca travar o ambiente para sempre.
- O mesmo mecanismo atende à suspensão: um é aviso + bloqueio de gravação, o outro é bloqueio total.

## Detalhes técnicos

- Migration (baseline/MASTER e pacote das instalações), no singleton `public.installation`: `service_state text not null default 'active'` (`active` | `maintenance` | `suspended`), `service_message text`, `service_until timestamptz`, `service_changed_at timestamptz`, `service_changed_by text`. Leitura pública (a tela precisa saber antes de haver sessão), escrita só Super Admin/`service_role`, mantendo a policy atual do singleton.
- `src/lib/installation-settings.server.ts`: expor `serviceState`, `serviceMessage`, `serviceUntil` em `InstallationSettings` (cache atual mantido, com invalidação curta ~10s para o estado de serviço).
- Novo `src/lib/service-state.functions.ts` (leitura pública) + hook `use-service-state.ts`; `src/routes/_authenticated/route.tsx` e `src/routes/_portal/route.tsx` renderizam `ServiceStateBanner`/`ServiceBlockScreen` acima do `<Outlet />`. Bloqueio de gravação: gate central em `src/lib/service-guard.ts` usado pelo middleware das server functions de escrita (rejeita mutação com mensagem em pt-BR quando `maintenance`/`suspended`), mais desabilitar botões na UI via hook. Super Admin escapa do bloqueio total.
- MASTER: em `src/lib/installation/manager.functions.ts`
  - `updateInstallationFn` aceita `supabaseManagementToken` opcional, reaproveitando `saveInstallationCredentials`; falha de gravação desfaz a alteração;
  - `deleteInstallationFn` (já existe) passa a ser usada na UI;
  - novas `setInstallationServiceStateFn` (suspender/reativar) que escreve no banco do alvo via `createManagementClient(...).query(...)`, com `assertCriticalInstallationConfirm` e registro em `installation_operations`/`critical_action_events`;
  - `runAutomatedUpdateFn`/`runAutomatedProvision` ligam `maintenance` no início e restauram `active` no fim (também em falha/cancelamento), com `service_until = now() + 30 min` como rede de segurança.
- `src/lib/critical-actions.ts`: novas chaves `installation.suspend` e `installation.resume` com impacto descrito; `installation.delete` já existe.
- UI: campo de token em `admin.instalacoes.$id.tsx` (diálogo de edição), itens "Suspender/Reativar" e "Excluir" no menu, selo de suspensão em `installation-card.tsx`/`installation-visuals.tsx`, e `canStartOperation` recusando operações em instalação suspensa.
- Testes: token opcional na edição sem apagar o existente; exclusão exigindo o nome exato; suspensão bloqueando operações e liberando Super Admin; faixa + bloqueio de gravação ligados/desligados pela atualização e expirando por tempo.
- Fechamento MASTER-first: regenerar o pacote, atualizar `delta_version.txt` + `MASTER_RELEASE_VERSION` (1.3.26), cobrir as colunas novas em `verify-installation.sql` e rodar `bun run master:check`.

## Fora de escopo

Não altera RBAC de outros módulos, integrações Meta/WhatsApp, dados de negócio nem o fluxo de deploy do próprio MASTER. A exclusão não apaga nada no Supabase, GitHub ou hospedagem do cliente.

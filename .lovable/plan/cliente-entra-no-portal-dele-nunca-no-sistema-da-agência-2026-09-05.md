# Cliente entra no portal dele — nunca no sistema da agência

## O problema (confirmado)

Ao criar o acesso do cliente, a conta é criada sem marcar que ela é "contato de cliente". Por causa disso, o banco vincula a conta automaticamente ao workspace como se fosse funcionário. Resultado: ao entrar, o cliente cai no sistema da agência (Painel, Clientes, Projetos, Tarefas) em vez do portal dele.

Além disso, o portal atual tem um layout que lembra demais o sistema interno, e nem todos os módulos respeitam a matriz de permissões do cliente.

## O que vou fazer

### 1. O cliente nunca mais entra no sistema da agência

- Marcar a conta como contato de cliente no momento da criação, para o banco não vinculá-la ao workspace.
- Trava no banco: uma conta que é contato de cliente não pode receber vínculo de equipe. Se alguém tentar, é bloqueado.
- Limpeza automática: contas de contato que já receberam vínculo indevido de equipe (é o caso na Taveira) perdem esse vínculo.
- Ao entrar, quem é contato de cliente vai direto para o portal, mesmo que exista algum resquício de vínculo antigo — e não consegue abrir nenhuma tela interna.

### 2. Portal com cara de portal, identidade da agência

Layout próprio, distinto do sistema interno, com a marca da agência:

- Topo com o logo e as cores da agência, nome do cliente ao lado e menu do usuário (conta, avisos, sair).
- Navegação enxuta em barra superior no desktop e barra inferior fixa no celular (pensado para toque, alvos grandes).
- Início como painel de boas-vindas: "o que precisa de você" primeiro (aprovações pendentes, prazos, pedidos em andamento), depois o resto.
- Cartões claros, textos em linguagem de cliente, sem jargão interno, sem menu de módulos da agência.
- Rodapé com assinatura da agência.

### 3. Permissões ligadas de ponta a ponta

- Revisão dos módulos do portal: Aprovações, Pauta, Calendário, Briefing, Arquivos, Minha Marca, Pedidos, além de Avisos e Minha Conta (sempre disponíveis para quem tem login).
- Três níveis por módulo: Sem acesso (não aparece), Somente ver, Ver e interagir.
- O menu, os botões e as ações passam a seguir exatamente esse nível; o que está bloqueado não aparece, e o que é somente leitura mostra aviso amigável em vez de botão morto.
- Bloqueio real no servidor em todas as consultas e ações do portal, não apenas na tela.
- Link sem senha continua existindo como acompanhamento somente leitura.

### 4. Levar para a Taveira e para as próximas instalações

As correções entram no pacote de atualização das instalações, com nova versão do sistema, para a Taveira ser corrigida pelo painel de instalações.

## Detalhes técnicos

- `createPortalContact` (`src/lib/portal-accounts.functions.ts`): enviar `role: "portal_client"` em `user_metadata` para `handle_new_user` pular o insert em `brand_members`; após criar, remover defensivamente qualquer `brand_members` do novo `user_id`.
- Migration: trigger `BEFORE INSERT/UPDATE ON public.brand_members` que rejeita usuário com `client_members.role = 'portal_client'`; backfill deletando `brand_members` desses usuários; manter `handle_new_user` como está (já trata `portal_client`).
- Gate: em `src/routes/_authenticated/route.tsx` e `src/components/login-form.tsx`, redirecionar para `/area/inicio` quando `isPortalUser` for verdadeiro (sem depender de `!isTeamMember`); `src/routes/_portal/route.tsx` mantém o inverso.
- Shell: reescrever `src/components/portal/portal-shell.tsx` (topbar + bottom nav mobile + branding da agência via `use-brand-branding`/`portal-theme`), mantendo `portal-nav.ts` como fonte única de abas e os dois modos via `PortalModeProvider`.
- Permissões: `portal-nav.ts` ganha o mapa aba→módulo; `portal-tabs.tsx` e as telas usam `portalCanView`/`portalCanInteract`; auditar cada server fn do portal (`portal-briefing`, `portal-pauta`, `portal-schedule`, `portal-requests`, `portal-comments`, `portal-brand`, `portal-data.server`) garantindo `resolvePortalSessionScope(..., need)` em toda leitura/escrita.
- Entrega: regenerar `supabase/baseline-snapshot/007_delta_migrations.sql` e subir `MASTER_RELEASE_VERSION`.
- Testes: estender `tests/portal-permissions.unit.test.ts` e adicionar teste garantindo que contato de portal nunca vira membro de equipe.

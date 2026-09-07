# Histórico de acessos ao sistema

Hoje o sistema guarda auditoria de ações (Configurações → Auditoria), mas não guarda nenhum registro de login: não há data do último acesso nem frequência por pessoa. Vou criar esse registro e uma tela para ler.

## O que você vai ver

Nova tela **Configurações → Acessos**, visível apenas para Owner e Admin do workspace (Super Admin vê todos os workspaces). Manager e usuários comuns não veem o item no menu nem conseguem abrir a página.

A tela terá:

- **Resumo do topo**: pessoas ativas hoje, ativas nos últimos 7 e 30 dias, total de entradas no período e quantidade de tentativas falhas.
- **Lista por pessoa**: nome, e-mail, tipo (equipe ou cliente do portal), último acesso, quantidade de acessos no período, dispositivo mais usado e um mini-gráfico de frequência por dia. Quem nunca entrou aparece marcado como "sem acesso".
- **Histórico detalhado**: cada entrada com data/hora no fuso de Brasília, pessoa, tipo, resultado (entrou / falhou), navegador e sistema, e cidade/país aproximados.
- **Filtros**: período, tipo de pessoa (equipe / cliente), pessoa específica, apenas falhas, busca por nome ou e-mail.
- **Exportar CSV** do período filtrado.

Clientes do portal aparecem identificados como tal, com o cliente ao qual pertencem.

## Como o registro funciona

Cada entrada bem-sucedida no login (e-mail/senha, Google e primeiro acesso) grava um registro. Tentativas que falham por senha errada também ficam registradas, sem nunca guardar a senha. O registro fica no banco do próprio workspace, sujeito às mesmas regras de isolamento do resto do sistema: um workspace nunca vê acessos de outro, e cliente do portal nunca vê essa tela.

Local aproximado vem de uma estimativa pelo endereço de conexão (cidade/país); o IP em si é guardado apenas de forma reduzida, para não expor dado desnecessário.

## Detalhes técnicos

- Migration: `public.user_login_events` (`user_id`, `brand_id`, `client_id` nulo para equipe, `kind` = `team` | `portal_client`, `event` = `sign_in` | `failed`, `provider`, `user_agent`, `device`/`os`/`browser` derivados, `ip_prefix`, `city`, `country`, `created_at`), com GRANTs (`authenticated` select, `service_role` all), RLS habilitada e policies: leitura só para Owner/Admin do workspace via `app_access_role` e para `is_super_admin`; nenhuma escrita direta pelo cliente. Índices por (`brand_id`, `created_at desc`) e (`user_id`, `created_at desc`). Retenção de 180 dias limpa por job existente de retenção.
- Gravação: server fn `recordLoginEventFn` em `src/lib/login-audit.functions.ts` chamada logo após sucesso no login; e um caminho para falhas que recebe apenas o e-mail tentado e resolve `user_id` server-side (sem revelar existência da conta na resposta). Escrita via `supabaseAdmin` carregado dentro do handler.
- Leitura: `listLoginActivityFn` + `getLoginActivitySummaryFn` protegidas por `requireSupabaseAuth` e `assertAdminAuthority`, com escopo por `brand_id` ativo, agregação por pessoa e série diária.
- UI: rota `src/routes/_authenticated/settings.access-log.tsx` + componentes em `src/components/settings/access-log/`; KPIs sempre via `PageKpi`/`PageKpiGrid`; datas via `src/lib/timezone.ts`; nomes/e-mails via `src/lib/identity.ts`.
- Menu: item adicionado ao Settings condicionado ao papel, seguindo `workspace-admin.ts`.
- Pontos de instrumentação: `src/routes/login.tsx`, fluxo Google (`lovable.auth.signInWithOAuth`), `reset-password`/primeiro acesso e o redirecionamento de `portal_client` para `/area/inicio`.
- Testes: unitários de derivação de dispositivo/navegador e de agregação por pessoa/dia; teste de autorização garantindo que Manager/usuário e portal recebem negação.
- Propagação: regenerar `supabase/baseline-snapshot/007_delta_migrations.sql` e subir `MASTER_RELEASE_VERSION` para `1.0.9`, para que Taveira e futuras instalações recebam a mesma tabela e regras.

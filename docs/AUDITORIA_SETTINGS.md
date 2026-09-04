# Auditoria funcional — área Settings (read-only, 2026-08-18)

Escopo: `src/routes/_authenticated/settings*.tsx`, `src/lib/{team,profile,sla,logs,ai-limits}.functions.ts`,
`src/lib/permissions.ts`, `src/hooks/use-access-role.tsx`, tabelas `brand_members`, `brand_invites`,
`client_members`, `clients`, `brands`, `user_profiles`, `sla_rules`, `content_pipeline_stages`,
`ai_usage_limits`, `activity_events`, `portal_tokens` + RLS.

## 0. Mapa atual

| Rota | Estado | Backend real |
|---|---|---|
| `/settings` | redirect → `/settings/profile` | — |
| `/settings/profile` | funcional | `profile.functions` (`user_profiles`) |
| `/settings/notifications` | funcional na gravação | `user_profiles.notification_prefs` |
| `/settings/identity` | funcional (branding + dados fiscais) | `brands` + storage `brand-assets` |
| `/settings/team` | funcional | `brand_members`, `brand_invites`, `portal_tokens`, `clients` |
| `/settings/permissions` | somente leitura (matriz derivada) | `brand_members` via `listBrandTeam` |
| `/settings/sla` | funcional em stages; `sla_rules` sem efeito | `content_pipeline_stages`, `sla_rules` |
| `/settings/logs` | funcional (agregação) | `ai_jobs` + `activity_events` + `notifications` |
| `/settings/ai-limits` | funcional e realmente aplicado | `ai_usage_limits` + `check_ai_usage_budget` |
| `/settings/branding` | redirect → `/settings/identity` | — |
| `/settings/overages` | redirect → `/customers` | — |

Dados hoje no banco: 3 perfis, 2 `brand_members` (ambos `owner`), **0** `client_members`,
**0** `sla_rules`, 3 `ai_usage_limits`.

---

## 1. Usuários, membros, clientes e papéis

**Funciona:** `brand_members` é a fonte usada pela UI (papel + permissões); convites por
`brand_invites` com token, expiração, revogação e senha temporária; `provisionUser`/
`addExistingUserToBrand` criam usuário + vínculo de marca/cliente; portais de cliente
(`portal_tokens`) listados e revogáveis na aba Equipe.

**Duplicado:** três fontes de "papel" convivendo — `brand_members.role` (enum `app_role`),
`user_profiles.role` (texto livre; hoje `admin`/`super_admin`) e `user_profiles.is_super_admin`
(flag booleana). O código só respeita `brand_members.role` + `is_super_admin`;
`user_profiles.role` é lido apenas para exibição. Escopo de cliente também está duplicado:
`clients.owner_user_id` (usado por `useAccessRole`) e `client_members` (tabela existe, com RLS
e role `portal_client`, mas está vazia e não influencia nenhum gate interno).

**Inconsistente:** o papel `client` do enum `app_role` não tem tela nem fluxo — cliente real
entra por `portal_tokens`/`client_members.role='portal_client'`, que não é um `app_role`.
Aba Equipe mistura escopos: membros da agência (workspace) e portais de clientes (escopo cliente).

**Deveria existir:** uma única resolução de identidade — `brand_members.role` como papel interno,
`client_members` como vínculo de cliente/portal, `is_super_admin` como flag de plataforma.
Gestão de portal do cliente deveria viver no painel do cliente, não em Settings.

**Remover/simplificar:** `user_profiles.role`; e decidir entre `clients.owner_user_id` e
`client_members` como mecanismo de escopo (hoje só o primeiro funciona).

## 2. Roles e níveis de permissão

**Funciona:** `resolveAccessRole` (owner/manager → `admin`; editor/designer → `user`) governa
sidebar e o gate das abas administrativas de Settings; RLS usa `has_brand_role`,
`is_brand_member`, `is_super_admin`, `can_access_client`.

**Duplicado:** dois modelos paralelos de autorização — a matriz binária `AccessRole`
(admin/user) e o conjunto granular `PermissionId` (`admin.full`, `pipelines.*`,
`automations.*`, `ai.*`) gravado em `brand_members.permissions`.

**Inconsistente/errado:** as permissões granulares **não têm nenhum consumidor** fora das telas
de Settings (`add-member-drawer`, `team`, `permissions`) — nenhuma server function, RLS ou rota
chama `hasPermission`. Além disso, o grupo `automations.*` referencia um módulo que não existe
no produto. Efeito prático: qualquer permissão marcada/desmarcada não muda nada.

**Deveria existir:** um conjunto de capacidades que espelhe módulos reais (conteúdo/pauta,
projetos & tarefas, canais/integrações, IA, clientes, configurações), verificado no servidor.

**Remover/simplificar:** enquanto não houver verificação server-side, reduzir para papel +
`is_super_admin` e remover a UI de checkboxes granulares (ou implementá-los de verdade).

## 3. Herança e aplicação das permissões

**Funciona:** `ROLE_DEFAULT_PERMISSIONS` aplica um preset no convite; `ai_usage_limits` tem
herança real de escopo (usuário → cliente → marca) aplicada por `check_ai_usage_budget`.

**Inconsistente/errado (principal risco):**
- `brand_members` só é gravável por **owner** (`owners manage brand members`), mas a UI trata
  **manager** como admin e `updateBrandMember`/`removeBrandMember` não checam papel → manager
  edita papel/permissão e a operação falha ou não persiste silenciosamente.
- `brands` só é atualizável por **owner** (`owner updates brand`), mas `/settings/identity`
  está liberada para manager → salvar identidade/dados fiscais como manager falha por RLS.
- `content_pipeline_stages` é gravável por **qualquer membro da marca** → editor/designer pode
  alterar o SLA por etapa, mesmo com a aba SLA marcada como administrativa na navegação.
- `inviteBrandMembers` checa owner/manager no servidor, mas `updateBrandMember`,
  `removeBrandMember`, `revokeBrandInvite` e `revokePortalToken` confiam apenas na RLS.

**Deveria existir:** paridade explícita UI ↔ server function ↔ RLS para cada ação, com manager
autorizado (ou explicitamente bloqueado) nos três níveis, e mensagens de erro de permissão.

**Remover/simplificar:** o gate só na navegação; migrar para checagem no handler.

## 4. Workspace, marca e cliente

**Funciona:** `/settings/identity` consolida logos (claro/escuro/ícone) e cadastro
(CNPJ/CPF, razão social, endereço) na tabela `brands`; upload por bucket `brand-assets`
com limpeza do arquivo anterior.

**Duplicado:** `brands` guarda tanto identidade visual quanto dados fiscais e endereço;
`clients` repete o mesmo tipo de dado (logo, favicon, endereço, contrato) — dois cadastros
com semânticas diferentes, sem componente compartilhado.

**Inconsistente:** não há noção de "workspace" real — marca (`brands`) faz o papel de workspace,
mas o produto fala em workspace/agência/marca de forma intercambiável; `brand_features`/
`feature_catalog` existem e não aparecem em Settings.

**Deveria existir:** Settings = escopo workspace/marca apenas. Dados de cliente permanecem
no painel do cliente. Se houver white-label, a identidade precisa ser lida por um provider único.

**Remover/simplificar:** o stub `/settings/branding` (manter apenas como redirect temporário)
e a duplicação de campos de endereço entre `brands` e `clients` via componente comum.

## 5. Notificações

**Funciona:** a tela grava `user_profiles.notification_prefs` e `notify_whatsapp`; a
Central de Notificações (in-app) funciona com dedupe e janelas.

**Duplicado:** contagem/KPI de canais duplica informação já visível nos switches; WhatsApp
aparece em duas dimensões (`notify_whatsapp` do usuário e `whatsapp_client_portal` dentro do JSON).

**Inconsistente/errado (crítico):** **nenhum produtor lê as preferências.** `notification_prefs`
e `notify_whatsapp` não são consultados por `insertNotificationsDeduped`, pelo cron
`sla-check`, por `enqueue_deadline_notifications` nem pelo envio de mensageria. Ou seja: a tela
sugere controle de canais/tipos que não existe. Também não há preferências por marca (só por
usuário) nem opt-out por tipo de evento real (aprovação, publicação, prazo, SLA).

**Deveria existir:** matriz evento × canal (in-app / e-mail / WhatsApp) lida no ponto de envio,
com fallback padrão e respeito ao `message_templates`/mensageria configurada.

**Remover/simplificar:** enquanto não houver leitura no envio, reduzir a tela ao que é real
(in-app) e rotular o resto como indisponível — hoje é configuração fantasma.

## 6. Identidade

Ver item 4. Resumo: funciona e persiste; risco de RLS para manager; concentra dois assuntos
(marca visual e pessoa jurídica) que merecem seções distintas na mesma aba; sem preview de
aplicação (login, portal, e-mails) — os logos são usados apenas parcialmente pelo app.

## 7. Equipe & Acesso

**Funciona:** listagem de membros com papel/permissões, convites pendentes/revogados,
adicionar membro (drawer com provisionamento), remover membro, revogar convite e portal.

**Duplicado:** permissões editáveis aqui e explicadas em `/settings/permissions` (duas telas
para o mesmo modelo); KPIs próprios (`SettingsStatCard`) em vez do padrão canônico
`PageKpi`/`PageKpiGrid`; portais de cliente também gerenciáveis pelo painel do cliente.

**Inconsistente:** manager vê ações que a RLS bloqueia (item 3); não há indicação de "último
owner" (é possível tentar remover o único owner); nenhum log de auditoria é gravado ao mudar
papel/permissão (activity_events não recebe evento de Settings).

**Deveria existir:** ação única de gestão de acesso (papel + escopo de clientes + portal),
proteção de último owner, e registro de auditoria em cada mudança de acesso.

**Remover/simplificar:** absorver `/settings/permissions` como aba/painel informativo dentro
de Equipe & Acesso.

## 8. SLA

**Funciona:** SLA por etapa de pipeline (`content_pipeline_stages.sla_hours`/`sla_days`) é
editável e **realmente aplicado** pelo cron `/api/public/cron/sla-check`, que notifica
responsável e gera resumo para owners/managers.

**Duplicado:** duas unidades para o mesmo conceito (`sla_hours` e `sla_days`, resolvidas por
`stageSlaHours`); e dois modelos de SLA (por etapa e `sla_rules` por projeto/papel/agente).

**Inconsistente/errado:** `sla_rules` tem tabela, RLS, server functions e UI completa, mas
**nenhum consumidor** — zero linhas e nenhuma leitura fora da própria tela. É configuração
sem efeito. Além disso a edição de SLA por etapa não exige papel administrativo na RLS.

**Deveria existir:** um único modelo de SLA (etapa do pipeline) com unidade única em horas,
restrito a admin, e — se prazos por papel/projeto forem requisito — um consumidor real antes
da UI.

**Remover/simplificar:** remover ou congelar a seção `sla_rules`; normalizar para horas.

## 9. Auditoria

**Funciona:** `/settings/logs` agrega três fontes (`ai_jobs`, `activity_events`,
`notifications`) com filtros por nível/origem/busca e checagem de pertencimento à marca.

**Duplicado:** `activity_events` (produto) + `ai_jobs` (execuções de IA) + `notifications`
(entregas) exibidos como se fossem um mesmo log; o Brain mantém sua própria trilha
(`brain_events`, `brain_reasoning_logs`) fora desta tela.

**Inconsistente/errado:** não é auditoria de segurança — mudanças de papel, permissão,
identidade, SLA, limites de IA e conexões não geram evento; a leitura de `activity_events`
é permitida a qualquer membro da marca (não só admin), embora a aba seja administrativa;
sem retenção/exportação.

**Deveria existir:** trilha de auditoria dedicada (ator, ação, entidade, antes/depois, IP)
gravada por todas as ações administrativas, somente admin, com exportação; logs operacionais
de IA continuam em outra tela.

**Remover/simplificar:** tirar `notifications` da visão de auditoria (é entrega, não evento).

## 10. Limites de IA

**Funciona:** a área mais consistente. `ai_usage_limits` com escopos marca/cliente/usuário,
período, `limit_usd`, `hard_stop`, `notify_at_pct`; RLS por `can_manage_brand_ai_limits`;
aplicação real em `ai-provider.server.ts` via `check_ai_usage_budget`.

**Duplicado:** consumo/custo de IA aparece aqui e no centro de IA em Integrações → IA
(métricas semelhantes com componentes diferentes).

**Inconsistente:** provedores/modelos e chaves ficam em Integrações → IA, limites em Settings —
a governança está partida em dois lugares; alerta `notify_at_pct` não tem canal definido
(depende do item 5, que não é aplicado).

**Deveria existir:** governança de IA em um só lugar (provedores, chaves, limites, consumo),
com alerta de percentual realmente disparado.

**Remover/simplificar:** mover "Limites de IA" para o centro de IA ou trazer o consumo para cá,
eliminando a métrica duplicada.

---

## Prioridades sugeridas (antes de qualquer refatoração visual)

1. **P0 — Permissões efetivas:** alinhar manager em UI/server/RLS (`brand_members`, `brands`)
   e restringir escrita de SLA por etapa. Hoje há ações visíveis que falham.
2. **P0 — Configuração fantasma:** decidir sobre `notification_prefs` (aplicar no envio) e
   `sla_rules` / permissões granulares (implementar ou remover). São três telas que prometem
   comportamento inexistente.
3. **P1 — Fonte única de papel:** eliminar `user_profiles.role`; escolher entre
   `clients.owner_user_id` e `client_members`.
4. **P1 — Consolidar telas:** Permissões dentro de Equipe & Acesso; Limites de IA junto do
   centro de IA; auditoria separada de logs operacionais.
5. **P2 — Padrão visual:** substituir `SettingsStatCard` por `PageKpi`/`PageKpiGrid` (regra do
   design system) apenas depois de definida a estrutura.

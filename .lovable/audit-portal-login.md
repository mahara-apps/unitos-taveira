# Mapeamento técnico — Portal do Cliente com login, perfil e pauta

Levantamento de terreno (nenhum código alterado). Base: Fases 0–4b já entregues
(link único por token, sem sessão).

---

## 1. Impacto no modelo atual de acesso

### Como funciona hoje

Todo o portal passa por `src/lib/portal-public.functions.ts`, que usa a chave
**publishable** (nunca service role) e chama 10 RPCs `SECURITY DEFINER`:

| RPC | Assinatura | Papel |
| --- | --- | --- |
| `portal_resolve` | `_token` | identidade do cliente + marca + tema |
| `portal_metrics` | `_token` | 4 números do Início |
| `portal_approvals` | `_token,_status` | posts em aprovação |
| `portal_post` | `_token,_post_id` | detalhe do post |
| `portal_decide` | `_token,_post_id,_decision,_note,_identity` | decisão do cliente |
| `portal_calendar` | `_token,_month` | agendados/publicados |
| `portal_files` | `_token,_search` | documentos `visible_to_client` |
| `portal_briefings` | `_token` | briefings do cliente |
| `portal_rate_status` / `portal_rate_register_failure` | `_ip_hash` | rate limit |

Todas resolvem o escopo por `public._portal_session(_token)`, que valida
revogação/expiração, faz `RAISE EXCEPTION invalid_token|token_revoked|token_expired`
e atualiza `portal_tokens.last_seen_at` (throttle de 5 min).

### O que muda com login

Sim — com sessão real as RPCs precisam de uma segunda forma de resolver o
escopo. Três desenhos possíveis:

- **A. Sessão substitui o token:** `_portal_session` deixa de existir e cada
  RPC vira uma query com RLS por `auth.uid()`. Mais limpo, mas reescreve 8 RPCs
  + todas as chamadas do front + quebra os links já distribuídos.
- **B. Dual-mode (recomendado para transição):** `_portal_session(_token)` ganha
  um irmão `_portal_session_user()` que resolve `client_id` por `auth.uid()`
  (via `client_members`), e cada RPC aceita `_token text DEFAULT NULL`,
  caindo na sessão quando o token vem nulo. Front passa a mandar o bearer
  (o `functionMiddleware` do `src/start.ts` já anexa) e omite o token.
- **C. Só uma camada de sessão por cima:** manter tudo por token e usar o login
  apenas para "desbloquear" o token no client. Frágil — o token continua sendo
  a credencial real; não recomendo.

### Token vs. login

Não são mutuamente exclusivos. Decisão a tomar (afeta o card):

- **Coexistência:** login é o caminho normal; o token continua válido para
  compartilhamento rápido/leitura. O card "Portal do cliente" no perfil segue
  igual, ganhando uma seção de **Acessos** (contatos com login, status, reenviar
  senha).
- **Login substitui:** `portal_tokens` passa a ser apenas *link de conveniência
  que exige login* (o token vira só o "atalho" para a URL do portal, e a RPC
  exige sessão), ou é aposentado. Nesse caso o card muda de "copiar link
  secreto" para "convidar acesso" — copiar/WhatsApp passam a mandar a URL
  pública do portal + e-mail do contato, e a senha provisória vai separada.

### Já existe usuário associado a cliente?

Sim, a infraestrutura existe e está **vazia** — nunca foi usada:

- `public.client_members (id, brand_id, client_id, user_id, role, created_at, created_by)` — **0 linhas**.
- `app_role` já inclui o valor `'client'` (usado no seletor de papéis de equipe: `ROLES` em `src/lib/team.functions.ts`).
- `public.can_access_client(_client_id,_user_id)` já implementa a lógica:
  super admin → true; se o cliente tem linhas em `client_members`, exige
  pertencer; senão, qualquer membro da marca. **Atenção:** hoje, sem linhas em
  `client_members`, todo membro da marca acessa todos os clientes. Ao criar o
  primeiro `client_member` de um cliente, o acesso daquele cliente passa a ser
  restrito — isso é um efeito colateral direto e precisa ser tratado (ou
  ajustar a função para diferenciar papel interno de papel de portal).
- Contato do cliente hoje é texto solto em `clients.contact_name`,
  `contact_email`, `contact_phone`, `whatsapp` — não há tabela de contatos.

Portanto: **não precisa criar do zero**, mas precisa de (a) uma noção explícita
de "usuário de portal" (não confundir com membro interno) e (b) uma tabela de
contatos se quiser múltiplos acessos com nome/cargo próprios.

---

## 2. Senha provisória

### O que já existe (reaproveitável quase inteiro)

O fluxo de senha provisória **já está implementado para a equipe**:

- `src/lib/team.functions.ts` → `inviteBrandMembers` usa
  `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true })`
  e marca `user_profiles.requires_password_change = true`.
- `brand_invites` guarda `token`, `temp_password_sent`, `expires_at`, `revoked_at`.
- `src/components/auth/mandatory-password-reset.tsx` bloqueia a UI num diálogo
  não-dispensável até `supabase.auth.updateUser({ password })`, e depois chama
  `clearMyPasswordFlag()` (`src/lib/password.functions.ts`).
- `accept_brand_invite(_token)` (SECURITY DEFINER) vincula o usuário à marca.

Ou seja: o padrão da casa é **senha provisória gerada pelo sistema + troca
obrigatória no primeiro acesso**, não magic link. Replicar isso no portal é o
caminho de menor atrito: gerar senha, enviar por WhatsApp/e-mail junto do link,
`requires_password_change = true`, e o mesmo diálogo bloqueante dentro do
layout do portal.

Alternativa: `supabaseAdmin.auth.admin.inviteUserByEmail` (cliente define a
própria senha). Mais seguro, mas depende de entregabilidade de e-mail —
enquanto o canal real da agência é WhatsApp, a senha provisória ganha.

### Mesmo pool de `auth.users` ou isolado?

Supabase não oferece pools separados: **vai ser o mesmo `auth.users`**. O
isolamento tem de ser por autorização, e aqui está o principal risco do
projeto: hoje o acesso interno é decidido por `is_brand_member(brand_id, uid)`
e `brand_members`. Se um usuário de portal virar `brand_members` com
`role='client'`, ele passa a satisfazer `is_brand_member` e entra em dezenas de
policies internas por tabela.

Desenho seguro: **usuário de portal NÃO entra em `brand_members`.** Ele existe
em `auth.users` + `user_profiles` + uma linha de vínculo de portal
(`client_members` com papel de portal, ou uma tabela nova `portal_users` /
`client_contacts`), e um helper novo (ex.: `is_portal_user(uid)` /
`portal_client_ids(uid)`) alimenta só as policies/RPCs do portal. Precisa
também de um gate no `_authenticated`: um usuário de portal que abrir
`/dashboard` deve ser redirecionado ao portal, não ver a UI da agência.

### Multi-contato

O schema suporta N pessoas por cliente (`client_members` é N:N com unique por
par, e `portal_tokens` já é N por cliente). O que falta é **dados por pessoa**
(nome, cargo, telefone, permissão de aprovar ou só ver). Decisão de produto:

- 1 login por cliente: mais simples, mas quebra a auditoria (quem aprovou?) —
  hoje resolvida na mão pelo campo `_identity` do `portal_decide`, salvo em
  `post_approvals.decided_by_name`.
- N logins por cliente: com login, `decided_by` finalmente pode ser um
  `auth.uid()` real e `decided_by_name` deixa de ser texto digitado.
  Recomendado, e é o ganho de auditoria mais óbvio da mudança.

---

## 3. Tela de Perfil

Não existe nada disso no portal hoje: a "identidade" do visitante é um nome
digitado e guardado em `localStorage`
(`portal.identity.<clientId>`, hook `useIdentity` em `src/routes/portal.$token.tsx`),
usado só para preencher `_identity` nas decisões.

Referência interna existente: `src/routes/_authenticated/settings.profile.tsx`
+ `src/lib/profile.functions.ts` (nome, telefone, avatar, timezone, locale,
troca de senha) — a tela do portal pode espelhar esse formato.

Escopo a decidir, em dois blocos:

- **Conta (edição pelo cliente):** nome, e-mail (troca de e-mail exige
  confirmação — decidir se libera ou trava), telefone/WhatsApp, senha, avatar,
  preferência de notificação. Baixo risco.
- **Marca/cliente:** `clients.brand_hub`, `contact_*`, `socials`, cor/logo.
  Isso é o Briefing interno. Deixar **somente leitura** no Perfil e manter a
  aba Briefing existente (`client_briefing_tokens`, com `submitted_at`) como o
  único canal de escrita do cliente sobre a marca — senão surgem dois caminhos
  de edição concorrentes para o mesmo `brand_hub`.

---

## 4. Pauta dentro do portal

### Qual "pauta"

Existem **duas coisas chamadas pauta** no banco, e a mudança precisa escolher:

1. **`monthly_plans` + `monthly_plan_topics`** — é a Pauta Mensal do fluxo atual
   (wizard de geração, aprovação em lote, regeneração por item). Colunas
   relevantes: `monthly_plans.status`, `internal_approved_at/by`,
   `client_decision_at`, `client_feedback`, `client_decision_mode`,
   `context_sources`; `monthly_plan_topics.topic_title, content_format, angle,
   channel, target_audience, rationale, status, position, previous_title,
   previous_angle, client_status, client_comment, client_decision_at`.
   **4 planos, 38 tópicos** hoje. É esta.
2. `brand_pautas` (58 linhas) — repositório mais antigo de ideias por
   pilar/cohort, alimentado pelo Cérebro. Não é o gate de revisão.

### Já existe aprovação pública de pauta — fora do portal

`src/lib/monthly-plan-public.functions.ts` + rotas `/pauta/$planId?token=` e
`/plano/$planId?token=` usam `monthly_plan_tokens` (1 token ativo hoje) com
`resolveMonthlyPlanPublic` / `decideMonthlyPlanPublic`. Ou seja: **a
funcionalidade existe, mas por um segundo token, em uma segunda URL pública,
fora da navegação do portal.** A mudança pretendida é essencialmente
**absorver esse fluxo como aba do portal** — o que permite aposentar
`monthly_plan_tokens` (ou mantê-lo apenas como link avulso).

### Relação com `portal_decide`

São dois níveis de agregação, com implementações independentes:

| | Aprovações (aba atual) | Pauta |
| --- | --- | --- |
| Objeto | `posts` individuais (peça pronta) | `monthly_plan_topics` (tema/headline, antes da produção) |
| Onde grava | `post_approvals` (`status`, `notes`, `decided_by_name`) | `monthly_plan_topics.client_status/client_comment` + `monthly_plans.client_decision_at/client_feedback` |
| Momento | depois de produzido, antes de agendar | antes de existir post |
| Efeito | libera agendamento | `client_decision_mode` pode mover o Kanban automaticamente |

Não é a mesma ação em outro nível: é um estágio **anterior**. Aprovar a pauta
não aprova posts; aprovar posts não altera a pauta.

### Pauta vs. Calendário do portal

Diferentes e sequenciais: o Calendário (`portal_calendar`) mostra `posts` com
`stage` em `scheduled`/`published` — ou seja, o fim da linha. A pauta é a etapa
anterior (tema aprovado → post criado → aprovado → agendado → aparece no
calendário). Não há sobreposição de tabela.

### Escopo a decidir

Só visualizar a pauta aprovada internamente (`internal_approved_at not null`) é
o mínimo; permitir aprovar/pedir ajuste por item é o que a
`decideMonthlyPlanPublic` já faz e o que dá sentido ao login (decisão
atribuível a uma pessoa real em vez de nome digitado).

---

## 5. Segurança e RLS

### RLS nativo vs. RPCs SECURITY DEFINER

Com login, RLS por `auth.uid()` fica possível e **simplifica o modelo no longo
prazo** — mas o custo imediato não é pequeno, porque as tabelas envolvidas
(`posts`, `post_approvals`, `client_documents`, `monthly_plan*`,
`client_briefing_tokens`) já têm policies escritas para o time interno, e cada
uma passaria a precisar de uma segunda policy de portal, com projeção de
colunas segura (hoje a RPC é que decide *quais colunas* o cliente vê — RLS
filtra linhas, não colunas).

Recomendação: **híbrido**. Manter as RPCs como a superfície do portal (elas já
são o contrato de colunas e já são auditadas) e trocar apenas a *resolução de
escopo* de "token" para "token OU `auth.uid()`". RLS nativo entra depois, por
tabela, quando houver leitura direta (ex.: a tela de Perfil pode ler
`user_profiles` por RLS normal, sem RPC).

Ponto de atenção duro: as RPCs hoje são `SECURITY DEFINER` **executáveis por
`anon`** — foi exatamente isso que a auditoria de segurança anterior atacou em
outras funções. Se o portal passa a exigir sessão, o `EXECUTE` de `anon`
nessas RPCs deve ser revogado (ficando só `authenticated`), senão o login é
decorativo.

### Rate limit e auditoria

- `portal_rate_limit (ip_hash, window_start, fail_count, blocked_until)` só
  registra **falha de token**. Com login, a proteção equivalente é
  força-bruta de senha — parcialmente coberta pelo Supabase Auth, mas o mesmo
  mecanismo pode ser reaproveitado para falhas de login se o front chamar uma
  RPC de registro. No modelo dual-mode ele continua válido para o caminho por
  token.
- `portal_tokens.last_seen_at` (heartbeat de 5 min em `_portal_session`) perde
  sentido quando o acesso é por sessão. Equivalente novo: `last_seen_at` no
  registro de usuário de portal / contato.
- `activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)`
  hoje recebe `actor_id = NULL` nas ações do portal (não há usuário). Com
  login, `actor_id` passa a ser o `auth.uid()` real — ganho direto na trilha de
  auditoria, e o mesmo vale para `post_approvals.decided_by` (hoje nulo, com o
  nome em `decided_by_name` texto).

---

## 6. Migração

### Estado real hoje

| Cliente | contact_email | Token ativo | Pauta |
| --- | --- | --- | --- |
| Café Aurora | marina@cafeaurora.mock | sim | sim (4 planos / 38 tópicos no total do sistema) |
| Estúdio Lumina | camila@estudiolumina.com | sim | não |
| Verde Vivo Nutrição | contato@verdevivo.com.br | sim | não |

Outros 4 clientes (Cervejaria Viking, Dome, Maromba Fitness, Vereador Léo) não
têm portal nem e-mail de contato.

Notas de migração:
- `client_members` está em **0 linhas** — o backfill começa do zero, sem
  conflito, mas ativa o modo restritivo do `can_access_client` para os clientes
  tocados (ver §1).
- `marina@cafeaurora.mock` é um domínio inválido: **não recebe e-mail**. Para
  esse cliente a senha provisória só chega por WhatsApp, ou o e-mail precisa ser
  corrigido antes.
- Nenhum dos três e-mails de contato pode ser assumido como único: se o mesmo
  e-mail aparecer em dois clientes (ou já existir como usuário interno), o
  `createUser` falha por e-mail duplicado — `inviteBrandMembers` já trata isso
  listando usuários existentes antes de criar; o mesmo tratamento é necessário aqui.

### Convivência durante a transição

Recomendo virada em duas etapas, não big bang:

1. **Etapa 1 — login opcional:** RPCs em dual-mode, links por token continuam
   funcionando exatamente como hoje. Contas criadas e senhas enviadas para os 3
   clientes ativos. Perfil e Pauta já exigem sessão (recursos novos, sem
   regressão para quem usa o link).
2. **Etapa 2 — login obrigatório:** revoga `EXECUTE` de `anon` nas RPCs, o
   token passa a exigir sessão (ou é aposentado), e o card do perfil vira
   gestão de acessos. Só depois de confirmado que os 3 clientes entraram.

Isso mantém `expires_at = null` por padrão (regra já firmada na Fase 2) e evita
que um cliente perca acesso no meio da transição.

---

## Decisões que preciso de você antes do prompt de implementação

1. Token e login coexistem (Etapa 1/2) ou virada direta?
2. Usuário de portal fica fora de `brand_members` (recomendado) — e como
   redirecionar quem tentar `/dashboard`?
3. Senha provisória gerada pelo sistema (padrão da casa) ou invite por e-mail?
4. Um login por cliente ou N contatos com papéis (ver / aprovar)?
5. Perfil edita só conta, com dados da marca em leitura?
6. Na Pauta, cliente só vê ou também decide por item (absorvendo
   `monthly_plan_tokens`)?

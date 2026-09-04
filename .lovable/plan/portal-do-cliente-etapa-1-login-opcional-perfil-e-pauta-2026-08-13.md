# Portal do Cliente — Etapa 1: login opcional, Perfil e Pauta

Plano por fase, um commit por fase. Decisões travadas respeitadas; nada implementado ainda.

---

## Respostas às 4 perguntas antes do plano

### 1. Auditoria de `can_access_client` — ATENÇÃO, o backfill como escrito quebra acesso da equipe

A função hoje: se **existir qualquer linha** em `client_members` para o cliente, o acesso passa a exigir pertencer àquela lista (super admin sempre passa).

Estado real:

| Quem | Papel | Super admin | Efeito do backfill |
| --- | --- | --- | --- |
| Bruno Abreu (`b8df48a3`) | super_admin | sim | nenhum — passa sempre |
| Bruno Abreu (`admin@nexusflow.app`, `90f7c29f`) | brand owner | **não** | **perde** acesso aos 3 clientes |
| Lucas Lopes (`96f3cf0a`) | brand owner | **não** | **perde** acesso aos 3 clientes |

O impacto não é pontual: **21 policies em 20 tabelas** chamam `can_access_client` — `clients`, `posts`, `post_placements`, `post_approvals`, `tasks`, `projects`, `monthly_plans`, `activity_events`, `brand_briefings`, `brand_ai_content`, `brand_ai_versions`, `brand_personas`, `brand_swot`, `brand_competitors`, `brand_pautas`, `brand_voice_cards`, `client_briefings`, `client_briefing_tokens`, `media_plans`, `media_plan_items`. Os dois owners não-super-admin ficariam sem ver Café Aurora, Estúdio Lumina e Verde Vivo em todas elas.

**Correção proposta (melhor que backfillar a equipe):** o modo restritivo deve contar apenas vínculos **internos**, ignorando linhas de portal. `client_members.role` já existe (text, default `'editor'`), então o usuário de portal entra com `role = 'portal_client'` e a checagem de escopo vira `EXISTS (... WHERE client_id = _client_id AND role <> 'portal_client')`. Resultado: acesso da equipe fica **byte-idêntico** ao de hoje, sem precisar backfillar `brand_members` em `client_members` (o que congelaria a lista e criaria dívida a cada novo membro). A auditoria antes/depois será rodada como evidência no commit da Fase A.

### 2. E-mail do Café Aurora

Varri todos os campos do registro: `contact_email` = `marina@cafeaurora.mock`, `contact_phone` = `+55 11 99999-0000`, `socials` só tem handles (`@cafeaurora` no Instagram/TikTok/YouTube, telefone `31999999999`), `brand_hub` não tem e-mail. **Não existe e-mail real disponível** — preciso que você me passe o e-mail da Marina, ou eu crio a conta com um endereço que você indicar. Não vou criar conta em domínio `.mock`.

### 3. Rota do Perfil

Recomendo **não** pendurar Perfil em `/portal/$token`. O token é um segredo compartilhável; uma tela de conta ali convida a expor dados de pessoa por link. Proposta: árvore nova `src/routes/_portal/` (layout gate próprio, `ssr: false`, exige sessão + `is_portal_user`), com `/area/inicio`, `/area/aprovacoes`, `/area/calendario`, `/area/arquivos`, `/area/pauta`, `/area/perfil`. `/portal/$token/*` continua intocado para quem usa link. Os componentes de `src/components/portal/portal-tabs.tsx` são reaproveitados nas duas árvores; muda só o provider que resolve a sessão (token vs. auth) e a lista de abas (Pauta e Perfil só na árvore autenticada). Assim as Fases 4a/4b não são desfeitas.

### 4. Rate limit e `last_seen_at` (Fase B, itens 4 e 5)

- **Rate limit:** confirmado, não duplicar. `portal_rate_limit` continua exclusivo do caminho por token; Supabase Auth já limita tentativas de senha.
- **`last_seen_at`:** adicionar `client_members.last_seen_at` e gravar com o mesmo throttle de 5 min já usado em `_portal_session`. Evita tabela de sessões nova.

---

## Fase A — Schema e segurança de base *(commit 1)*

1. Migration: `can_access_client` passa a ignorar linhas `role = 'portal_client'` no teste de escopo; acesso interno preservado.
2. `client_members`: coluna `last_seen_at timestamptz`, índice por `user_id`, constraint permitindo N contatos por cliente (unique por `client_id, user_id`, já compatível) — schema pronto para multi-contato sem migração futura.
3. Helpers novos, `SECURITY DEFINER`, `search_path = public`, isolados de `is_brand_member`: `is_portal_user(_user_id uuid)` e `portal_client_ids(_user_id uuid)`.
4. RLS de portal: policy própria em `client_members` (usuário lê só a própria linha) e `user_profiles` (já existe self-access).
5. **Gate de saída:** confirmar que usuário de portal não satisfaz `is_brand_member` em nenhuma tabela (ele não entra em `brand_members`), e que os helpers não são chamados por policies internas. `GRANT EXECUTE` mínimo.
6. Gate no `_authenticated`: se autenticado e `is_portal_user` e não `is_brand_member`, `redirect` para `/area/inicio` — não tela de erro.
7. Evidência no commit: auditoria `can_access_client` antes/depois para os 3 usuários × 3 clientes.

## Fase B — RPCs em dual-mode *(commit 2)*

1. `public._portal_session_user()` resolvendo `client_id`/`brand_id` por `auth.uid()` via `client_members` (`role = 'portal_client'`), com o mesmo throttle de heartbeat gravando em `client_members.last_seen_at`.
2. As 8 RPCs passam a `_token text DEFAULT NULL`; nulo → sessão. Assinatura por `DEFAULT` mantém as chamadas atuais válidas sem tocar no front do modo token.
3. Contrato de colunas idêntico nos dois modos — validado comparando saída token vs. sessão para o mesmo cliente.
4. `portal_decide` no modo sessão grava `activity_events.actor_id = auth.uid()` e `post_approvals.decided_by = auth.uid()`; modo token continua NULL + `decided_by_name`.
5. `portal_rate_limit` inalterado (só token).
6. `GRANT EXECUTE` a `authenticated` mantendo `anon` como está — Etapa 2 revoga.

## Fase C — Criação de contas *(commit 3)*

1. Server function admin `createPortalAccess({ clientId })`, espelhando `inviteBrandMembers`: checa duplicidade em `auth.users` e entre clientes, `supabaseAdmin.auth.admin.createUser({ email_confirm: true })`, `user_profiles.requires_password_change = true`, insere `client_members` com `role = 'portal_client'`. Sem `brand_members`.
2. Senha provisória retornada em texto plano **só no retorno da função** — não logada, não persistida.
3. Recusa e-mail inválido/ausente com erro claro (bloqueia Café Aurora até você me passar o e-mail).
4. **Dry-run primeiro:** reporto a lista (cliente → e-mail → ação) antes de executar de fato, como na migração de tokens.
5. `MandatoryPasswordReset` reaproveitado dentro do layout `_portal`.

## Fase D — Tela de Perfil *(commit 4)*

1. Rota `/area/perfil` na árvore autenticada do portal (justificativa acima).
2. Editável: nome, telefone/WhatsApp, avatar, senha, preferências de notificação — reaproveitando `profile.functions.ts` e `notification_prefs`. E-mail via `supabase.auth.updateUser({ email })`, que já exige confirmação no endereço novo (mecanismo nativo, sem código de confirmação próprio).
3. Seção marca/cliente **somente leitura** (`contact_*`, resumo do `brand_hub`) com aviso de que atualização é pelo Briefing, sem formulário.

## Fase E — Gestão de acessos no card interno *(commit 5)*

1. Seção "Acesso por login" no card "Portal do cliente" (aba Gestão da conta): status (sem conta / conta criada / senha pendente de troca), botão "Criar acesso", exibição única da senha copiável com aviso.
2. Card de link por token permanece exatamente como está — a fase adiciona.

## Fase F — Pauta no portal *(commit 6)*

1. Aba `/area/pauta` (só sessão): tópicos do plano ativo com decisão por item e feedback do plano.
2. Gravação idêntica à de `decideMonthlyPlanPublic` — extraio o core para um helper compartilhado, para que o fluxo público por `monthly_plan_tokens` e o autenticado nunca divirjam.
3. Marcar `monthly_plan_tokens`, `/pauta/$planId` e `/plano/$planId` como candidatos a aposentadoria (comentário + nota), sem remover.

---

## Fora do escopo (Etapa 2)

Login obrigatório, revogação de `EXECUTE` de `anon`, aposentadoria do token. Nenhum recurso acessível por token hoje deixa de funcionar.

**Bloqueio conhecido:** Fase C não roda para Café Aurora sem um e-mail real. Fases A, B, D, E, F seguem independentes disso.

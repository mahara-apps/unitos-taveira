# Auditoria READ-ONLY — Webhook do Meta (Unitos Master)

Data: 2026-08-30 · Escopo: somente este projeto (Unitos Master). Nenhuma alteração de código, banco, RLS ou migration foi feita.

## Resumo executivo

```
URL DO WEBHOOK: https://unitos-master.lovable.app/api/public/meta/webhook
VERIFY TOKEN:   META_WEBHOOK_VERIFY_TOKEN  (nome da env/secret — valor não exibido)
OAUTH CALLBACK: https://unitos-master.lovable.app/api/public/meta/callback  (NÃO é o webhook)
STATUS: PODE CADASTRAR
```

## 1. Endpoints encontrados

| Endpoint | Arquivo | Função |
| --- | --- | --- |
| `GET/POST /api/public/meta/webhook` | `src/routes/api/public/meta/webhook.ts` | **Webhook único** para os produtos `page` (Facebook) e `instagram` |
| `GET /api/public/meta/callback` | `src/routes/api/public/meta/callback.ts` | OAuth redirect (troca de `code`) — não é webhook |
| `POST /api/public/meta/data-deletion` | `data-deletion.ts` | Data Deletion Callback (usa `signed_request`) |
| `POST /api/public/meta/deauthorize` | `deauthorize.ts` | Deauthorize Callback (`signed_request`) |
| `GET /api/public/meta/deletion-status` | `deletion-status.ts` | Página de status da exclusão |
| `POST /api/public/hooks/evolution/$token` | rota Evolution API | WhatsApp via **Evolution**, não via Meta/WhatsApp Cloud API |

Não existe endpoint separado por produto: **um único webhook** atende Page e Instagram. **Não há** handler para `object: "whatsapp_business_account"` nem para leads (`leadgen` só seria capturado genericamente como `changes[].field`).

## 2. Fluxo GET (verificação do Meta), passo a passo

`webhook.ts` → `server.handlers.GET`:
1. Lê `hub.mode`, `hub.verify_token`, `hub.challenge` da query string.
2. Lê `process.env.META_WEBHOOK_VERIFY_TOKEN`; se ausente → `500 "Webhook not configured"`.
3. Se `hub.mode === "subscribe"` **e** `hub.verify_token` idêntico ao env **e** `hub.challenge` presente → responde `200` com o `hub.challenge` em `text/plain`.
4. Qualquer outro caso → `403 Forbidden`.

Não exige sessão, cookie, login, bearer nem workspace: o prefixo `/api/public/*` desliga a autenticação do site. Verificado em execução local: requisição GET com token inválido retorna **403** (prova de que a rota está publicada e que o env está lido — se faltasse env retornaria 500).

## 3. Fluxo POST (eventos)

1. Exige `META_APP_SECRET`; ausente → `500`.
2. Lê o header `X-Hub-Signature-256` e o **corpo cru** (`request.text()`).
3. `verifySignature()`: HMAC-SHA256 (WebCrypto) do corpo cru com o app secret, prefixo `sha256=`, comparação em tempo aproximadamente constante. Assinatura inválida/ausente → **401** (payload adulterado é rejeitado).
4. `JSON.parse` do corpo; JSON inválido → `400`.
5. Roteia por `object`: `page` → canal `facebook`; `instagram` → `instagram`; outros → `200 ok` ignorado.
6. Resolve cada `entry[].id` (Page ID / IG Business ID) em `social_connections` (`provider = meta`, `channel`, `external_id`) via `supabaseAdmin`, obtendo `brand_id` — é aqui que o tenant é determinado.
7. Publica um evento por entry no Brain Event Bus (`brain.events.publish`) com `brand_id`, `source_module: "meta_webhook"`, `event_type: meta.<canal>.<campo>`.
8. Entries sem correspondência local são repassados aos peers de `META_WEBHOOK_PEERS` (multi-instalação), preservando corpo cru + assinatura, com header anti-loop `x-unitos-meta-forward: 1`.
9. Sempre responde `200 ok` (inclusive em erro de lookup) para evitar retries agressivos do Meta.

## 4. Headers/assinatura esperados

- `X-Hub-Signature-256: sha256=<hex hmac do corpo cru>` (obrigatório no POST).
- `Content-Type: application/json`.
- Verificação GET usa apenas query params, sem headers especiais.

## 5. Versão da Graph API

`v22.0` — `src/lib/meta/provider.server.ts` (`GRAPH_VERSION`), também em `publish-capability.server.ts` e `granular-scopes.server.ts`. A versão da subscrição do webhook no App Dashboard deve ser compatível (v22.0 ou superior).

## 6. Variáveis de ambiente / secrets

| Variável | Uso | Configurada hoje |
| --- | --- | --- |
| `META_WEBHOOK_VERIFY_TOKEN` | **Verificar token** do webhook (GET) | **Sim** |
| `META_APP_SECRET` | Assinatura `X-Hub-Signature-256`, `signed_request`, OAuth | **Sim** |
| `META_APP_ID` | OAuth | **Sim** |
| `META_REDIRECT_URI` | OAuth redirect canônico | **Sim** |
| `META_EXTRA_REDIRECT_HOSTS` | Hosts extras liberados no OAuth | Opcional, não definida |
| `META_STATE_SECRET` | Assinatura do `state` do OAuth; **fallback para `META_APP_SECRET`** | Não definida (recomendada em multi-instalação) |
| `META_WEBHOOK_PEERS` | Forward de webhook entre instalações | Opcional, não definida (correto para instalação única) |
| `PUBLIC_APP_URL` / `APP_URL` / `APP_PUBLIC_URL` | Links absolutos fora de requisição (`app-url.server.ts`); **não usado pelo webhook** | Não definida |
| `CRON_SECRET` | Endpoints de cron (`x-cron-secret`) — não se aplica ao webhook | Sim |

O webhook **não depende** de `PUBLIC_APP_URL`, `META_REDIRECT_URI` nem `META_STATE_SECRET`: ele responde no host em que a requisição chega.

## 7. Hardcodes de domínio

Apenas em comentários/documentação, sem efeito em runtime:
- `webhook.ts` (comentário): `https://unitos.lovable.app/api/public/meta/webhook`;
- `data-deletion.ts` (comentário): `https://unitos.sejaumpartner.com/...`;
- `docs/META_MULTI_INSTALACAO.md`.

Nenhum domínio Vercel/preview no código de webhook. A URL efetiva é o host publicado do projeto: `unitos-master.lovable.app`.

## 8. RBAC / RLS / escopo de tenant

- Rota pública por design (Meta não autentica com sessão). A autenticidade vem da assinatura HMAC, não de RBAC.
- Escrita usa `supabaseAdmin` (service role, ignora RLS) — importado **dentro** do handler, correto.
- Tenant nunca vem do payload: é derivado de `social_connections.external_id → brand_id`. Um Page ID não conectado nesta instalação não gera evento (só é repassado a peers, se configurados).

## 9. Distinção OAuth × Webhook (não confundir)

| Campo no Meta | Valor |
| --- | --- |
| Facebook Login → Valid OAuth Redirect URI | `https://unitos-master.lovable.app/api/public/meta/callback` |
| Webhooks → Callback URL | `https://unitos-master.lovable.app/api/public/meta/webhook` |
| Webhooks → Verify Token | valor de `META_WEBHOOK_VERIFY_TOKEN` |
| Assinatura do webhook | derivada de `META_APP_SECRET` (não se digita nada no Meta) |
| State secret do OAuth | `META_STATE_SECRET` (hoje cai em `META_APP_SECRET`) |

## 10. Problemas e riscos encontrados (nada bloqueia o cadastro)

1. **Sem idempotência de retries**: `brain.events.publish` faz insert simples, sem chave de deduplicação. Reentrega do Meta gera eventos duplicados. (Severidade: média.)
2. **WhatsApp Cloud API não suportado**: `object: "whatsapp_business_account"` é ignorado com `200 ok`. Se assinar o produto WhatsApp no mesmo App, os eventos são silenciosamente descartados. WhatsApp hoje é Evolution API, endpoint próprio.
3. **`META_STATE_SECRET` ausente** (afeta OAuth, não o webhook): o `state` é assinado com o app secret compartilhado.
4. **Erros de lookup respondem 200**, o que evita retry do Meta mas pode perder eventos em falha transitória do banco.
5. **Comentários com domínios antigos** podem induzir configuração errada.
6. `leadgen` seria aceito apenas como `changes[].field` genérico, sem processamento dedicado.

## 11. Instruções operacionais (tela “Configurar um webhook”)

1. Campo **URL de callback**: `https://unitos-master.lovable.app/api/public/meta/webhook`
2. Campo **Verificar token**: cole o valor exato já salvo no secret `META_WEBHOOK_VERIFY_TOKEN` deste projeto (Project Settings → Secrets). Não invente outro valor; não use o App Secret.
3. Clique em **Verificar e salvar** — o Meta fará o GET e deve receber o `hub.challenge` de volta.
4. Nos produtos, assine **Page** e **Instagram** (campos como `feed`, `mentions`, `messages`) usando versão v22.0+.
5. Não altere o campo de OAuth: o redirect URI segue `.../api/public/meta/callback`.

## 12. Conclusão

**PODE CADASTRAR AGORA.** O endpoint existe, é público (prefixo `/api/public/`), responde ao GET de verificação sem qualquer sessão, compara o token com `META_WEBHOOK_VERIFY_TOKEN` (secret já configurado) e valida `X-Hub-Signature-256` com `META_APP_SECRET` (também configurado) no POST. Os itens da seção 10 são melhorias posteriores (idempotência, WhatsApp Cloud, `META_STATE_SECRET`), não impedimentos à verificação pelo Meta.

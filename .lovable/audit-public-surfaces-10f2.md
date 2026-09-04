# FASE 10F.2 — Correção dos P2 das superfícies públicas

Base: `.lovable/audit-public-surfaces-10f1.md` (P0=0, P1=0, P2=5, P3=3). Escopo restrito aos P2 confirmados.
Não foram tocados: RBAC (`app_access_role`, `my_access`, `client_in_scope`), Portal, Brain, `message_logs`, `projects`/`tasks`, `activity_events`, Storage fora da logo de login, UI de aprovação.

## 1. Problemas corrigidos

| # | P2 da 10F.1 | Correção |
| --- | --- | --- |
| 1 | Sem rate limit/anti-brute-force | Rate limit server-side reaproveitando `public.portal_rate_limit` via nova função `public.public_surface_rate_hit` (executável só por `service_role`). Aplicado no `GET` e no `POST` da aprovação e em `getLoginLogoFn`. |
| 2 | Token de aprovação reutilizável após decisão | Decisão passou a ser **single-use**: a RPC transacional `public.card_approval_public_decide` grava o evento, aplica o estado e marca `revoked_at` no mesmo comando. Novo `POST` com o mesmo link → `410 token_used_or_revoked`. Peça já em estado terminal (`approved`/`rejected`) → `409 already_decided`. |
| 3 | `POST` aceitando peça excluída | A RPC relê a peça com `FOR UPDATE` imediatamente antes da mutação e recusa `deleted_at IS NOT NULL` (`410 post_deleted`), peça ausente (`404 post_not_found`) e par `brand_id` inconsistente (`403 scope_mismatch`). |
| 4 | CORS `*` com `POST` | Removidos todos os cabeçalhos `Access-Control-Allow-*`. A rota é same-origin (consumida por `/approval/$token`) e recusa com `403` qualquer requisição cujo `Origin` seja de host diferente, em `GET` e `POST`. Respostas passam a `cache-control: no-store` + `vary: origin`. |
| 5 | Payload público com campos internos | O `select` público foi reduzido ao contrato mínimo. Removidos `script`, `references`, `reference_media`, `client_id`, `post.id` e `token.id`. |
| 6 | `getLoginLogoFn` elegendo "última marca atualizada" | A marca passa a ser explícita: `LOGIN_BRAND_ID` ou `LOGIN_BRAND_SLUG` da instância; sem configuração, aceita apenas instalação com **exatamente uma** marca com logo de login; qualquer ambiguidade (0 ou ≥2 candidatas, marca configurada inexistente) devolve `null` e a UI usa o branding neutro do Unitos. Nunca escolhe primeira/última/aleatória. |
| 7 | Assinatura de asset privado sem escopo/limite | Antes de assinar, o path é validado estruturalmente contra a marca resolvida (`<brand_id>/…`, sem `..`), no bucket privado `brand-assets`. TTL reduzido de **6 h → 10 min** e a superfície ganhou rate limit. `service_role` continua sendo usado apenas para assinar, depois da validação de escopo. |

Ordem de confiança respeitada: request → validação no servidor (origem, verbo, rate limit) → validação de escopo (token → post → brand) → validação de estado do recurso → transação/RPC `SECURITY DEFINER` com `FOR UPDATE` → mutação.

## 2. Payload público final (`GET /api/public/approval/$token`)

```json
{
  "post": { "title", "copy", "format", "channels", "scheduled_at", "cover_url", "client_briefing", "review_status" },
  "client": { "name" },
  "token": { "expires_at" }
}
```

Consumidores mapeados antes da redução: apenas `src/routes/approval.$token.tsx` (usa `title, copy, format, channels, scheduled_at, cover_url, client_briefing, review_status, client.name`). Nenhum campo removido era renderizado. Nenhum outro consumidor existe no repositório.

## 3. Rate limit adotado

| Superfície | Chave | Janela | Limite | Bloqueio ao exceder |
| --- | --- | --- | --- | --- |
| `GET /api/public/approval/$token` | `approval-get:sha256(ip+salt)` | 300 s | 60 req | 600 s → `429` + `retry-after` |
| `POST /api/public/approval/$token` | `approval-post:sha256(ip+salt)` | 300 s | 10 req | 900 s → `429` + `retry-after` |
| `getLoginLogoFn` | `login-logo:sha256(ip+salt)` | 300 s | 60 req | 600 s → devolve `{url:null}` (branding neutro, sem erro visível) |

- Infraestrutura: tabela existente `public.portal_rate_limit` (sem RLS pública, acesso só por `SECURITY DEFINER`). Nenhum Redis, nenhuma tabela nova.
- IP nunca é persistido em claro (SHA-256 com salt de instância).
- Falha de infraestrutura no RPC não bloqueia o fluxo legítimo (fail-open apenas para o contador, nunca para autorização).

## 4. Arquivos alterados

- `src/routes/api/public/approval.$token.ts` — same-origin, rate limit, payload mínimo, decisão via RPC transacional.
- `src/lib/public-rate-limit.server.ts` — **novo**: `clientIp`, `rateKey`, `checkPublicRate`.
- `src/lib/login-branding.functions.ts` — resolução explícita de marca, validação de path, TTL 10 min, rate limit.
- `tests/public-surfaces-10f2.integration.test.ts` — **novo**: 18 casos.
- `.lovable/audit-public-surfaces-10f2.md` — este relatório.

## 5. Migration

Uma migration idempotente (`CREATE OR REPLACE FUNCTION` + `REVOKE`/`GRANT`), sem DDL de tabela, sem alteração de RLS existente, sem dado histórico tocado:

- `public.public_surface_rate_hit(text, int, int, int)` — contador por chave sobre `portal_rate_limit`.
- `public.card_approval_public_decide(text, text, text, text, text)` — decisão pública transacional.
- Ambas: `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`. Nenhum privilégio novo para `anon`.

## 6. `share_token` do plano de mídia

Verificado sem alteração estrutural, conforme o item 7 do escopo:

- plano inexistente/token inválido → `invalid_token` (confirmado por teste);
- cross-client e cross-workspace impossíveis: `client_id`/`brand_id` derivam da própria linha do plano (confirmado por teste);
- nenhum token existente foi invalidado ou rotacionado.

**P3 residual mantido deliberadamente:** ausência de expiração default e de rotação periódica; planos `archived`/`draft` continuam legíveis pelo link. Implementar isso exigiria mudança de contrato dos links já distribuídos.

## 7. Testes e validação

- Fase: `tests/public-surfaces-10f2.integration.test.ts` — **18/18 passando**. Cobrem: decisão válida; replay do mesmo link; peça já decidida; peça excluída; token inexistente; token expirado; token revogado; par brand/post inconsistente; verbo inválido; concorrência (duas decisões simultâneas → 1 sucesso, 1 falha, 1 único evento); `changes_requested` consumindo o link; `anon` sem `EXECUTE` nas duas RPCs; rate limit liberando abaixo e bloqueando acima com `retry_after`; escopo estrutural do path da logo; ambiguidade de múltiplas brands com logo; `share_token` inexistente e vínculo estrutural do plano.
- CORS verificado na rota viva: sem `Origin` → `404` (token inexistente, fluxo normal); `Origin` externa em `GET` → `403`; `POST` com `Origin` externa → `403`; resposta não emite `Access-Control-Allow-Origin`.
- Regressão completa: **398/398 testes, 23 arquivos**.
- Typecheck (`tsgo --noEmit`): limpo. Lint (ESLint/Prettier) dos arquivos alterados: limpo. Build: sem erros.
- Nenhum ataque destrutivo, nenhum dado de produção alterado (fixtures de QA criadas e removidas).

## 8. P2 restantes

Nenhum dos cinco P2 da 10F.1 permanece aberto.

## 9. P3 deliberadamente mantidos

1. `media_plans.share_token` sem expiração obrigatória/rotação; planos arquivados acessíveis pelo link.
2. Tokens de QA previsíveis (`brain22-t1-…`) persistidos em `card_approval_tokens` (fora do escopo por instrução explícita).
3. Tokens de compartilhamento armazenados em texto puro (debt aceito para links públicos).

## 10. Riscos residuais

- Rate limit é por IP: um atacante distribuído (múltiplos IPs) contorna o contador; a proteção real contra adivinhação continua sendo a entropia de 160/144 bits do token.
- A checagem de origem depende do header `Origin`: clientes não-browser (curl, scripts) que conheçam o token seguem podendo decidir — comportamento desejado para compatibilidade do link legítimo.
- Instalações multi-marca sem `LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG` passam a exibir o branding neutro em vez da logo de uma marca arbitrária (mudança intencional; a variável deve entrar no checklist de env vars por instância).
- Não há trilha dedicada de eventos de segurança para tentativas inválidas (fora do escopo desta fase).

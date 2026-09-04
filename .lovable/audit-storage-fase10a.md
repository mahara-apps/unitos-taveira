# Fase 10A — Hardening de Storage (arquivos)

**Escopo:** somente `storage.objects` dos buckets `brand-assets`,
`brand-documents`, `brand-media`. Nada fora de Storage foi alterado
(`message_logs`, `projects`/`tasks`/`activity_events`, dashboards, RBAC
estrutural e UI permanecem intactos).

## 1. Situação anterior (P1)

23 policies sobrepostas (OR-permissivas) nos três buckets, todas escopadas por
`is_brand_member(split_part(name,'/',1))` — ou seja, **qualquer membro do
workspace** lia/escrevia/apagava arquivos de **qualquer cliente**, bastando
trocar o segmento do path. `brand-documents` não tinha policy de UPDATE, e
`portal_anon_read_brand_assets` concedia leitura a `anon` com um predicado
inválido (comparava `clients.name` com o path).

## 2. Situação atual

Uma única fonte de verdade: `public.storage_scope_allows(bucket, name, write)`
(SECURITY DEFINER, `search_path` fixo, executável só por
`authenticated`/`service_role`) + 4 policies canônicas:

| Policy | Operação | Buckets |
| --- | --- | --- |
| `brand_files_scoped_select` | SELECT | os três |
| `brand_files_scoped_insert` | INSERT | os três |
| `brand_files_scoped_update` | UPDATE (USING + WITH CHECK) | os três |
| `brand_files_scoped_delete` | DELETE | os três |

Auxiliar: `public.safe_uuid(text)` (converte segmento em uuid sem lançar erro).

## 3. Como o cliente é determinado

Path canônico: `<brand_id>/<client_id>/...`.
O path **não é prova de autorização**: a função valida no banco que
`clients.id = <client_id> AND clients.brand_id = <brand_id>`. Se o par não
existir, o acesso é negado para todos os papéis (inclusive ADMIN).

Se o 2º segmento não for UUID (ex. `<brand>/logo_login-….png`,
`<brand>/clients/logos/…`), o recurso é considerado **de workspace**.

## 4. Autorização por papel

| Papel | Regra aplicada |
| --- | --- |
| SUPER ADMIN | `is_super_admin` → acesso total |
| ADMIN (owner) | `client_in_scope` → todos os clientes **do próprio workspace**; nunca cross-workspace |
| MANAGER | `client_in_scope` → somente clientes atribuídos |
| USER | `client_in_scope` → somente clientes atribuídos |
| PORTAL | `is_portal_client_of` → **somente leitura** do próprio cliente: documentos com `client_documents.visible_to_client = true` e identidade visual (`brand-assets`). `brand-media` negado |
| Recurso de workspace | `is_brand_admin_level` (owner/manager do próprio workspace) |
| `anon` | nenhuma policy — leitura anônima removida |

Uploads, updates e deletes usam exatamente o mesmo predicado das leituras.

## 5. Ataques de path forjado testados

- brand válida + `client_id` de outra marca → negado (inclusive ADMIN).
- `client_id` trocado por outro cliente do mesmo workspace não atribuído → negado.
- `client_id` inexistente → negado.
- `brand_id` inexistente → negado.
- 1º segmento não-UUID (`nao-uuid/…`, `public/…`) → negado, leitura e escrita.
- cross-workspace (membro de A tentando arquivo de B) → negado em SELECT e INSERT.
- cliente órfão (sem `owner_user_id` e sem `client_members`) → negado para
  MANAGER/USER, permitido apenas para ADMIN do workspace.

## 6. Testes

`tests/storage-scope.integration.test.ts` — **26 testes, todos verdes**,
exercidos com usuários reais e RLS de verdade (service role só para semear
arquivos). Regressão completa: **306/306** em 18 arquivos. Typecheck limpo.

## 7. Casos deliberadamente restritivos

- **Arquivos de workspace sem cliente determinável** (branding: `logo_light`,
  `logo_dark`, `icon`, `logo_login`, `clients/logos/…`): restritos a
  owner/manager/super admin. USER sem atribuição não assina esses paths —
  o app degrada para a logo padrão, sem erro. Nenhum fallback
  "brand member = pode acessar" foi criado. A tela de login continua
  funcionando porque assina via service role no servidor.
- **Objetos legados em `brand-media` no nível da marca** (`<brand>/arquivo.png`,
  2 objetos): passam a ser acessíveis só por admin/manager, até que sejam
  migrados para `<brand>/<client>/…`.
- **`brand-media` para PORTAL**: negado por RLS; o Portal continua recebendo
  mídia por URLs assinadas geradas no servidor após validação de sessão.

## 8. Correção adjacente necessária

`brain_trg_client_documents()` referenciava `NEW.file_name` (coluna
inexistente), o que fazia **todo** insert em `client_documents` falhar e
impedia validar a trilha de documentos. Corrigido para `NEW.name`. Nenhuma
outra alteração de dados/lógica foi feita.

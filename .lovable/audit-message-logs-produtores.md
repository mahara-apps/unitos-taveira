# FASE 10C.1 — Auditoria dos produtores de `public.message_logs` (read-only)

Nada foi alterado: sem código, sem migration, sem RLS, sem dados, sem UI.

## 1. Método

Varredura completa do repositório (`src/`, `supabase/`, `tests/`, docs) por
`message_logs`, `.from("message_logs")`, `INSERT INTO message_logs`,
`evolution`, `whatsapp`, mensageria, workers, cron, notificações, seed/demo;
mais varredura no banco em `pg_proc` (todas as funções `public` cujo corpo
menciona a tabela) e nos triggers da tabela.

## 2. Inventário — todos os pontos que tocam a tabela

| # | Arquivo / objeto | Função | Operação | Escreve? |
|---|---|---|---|---|
| 1 | `src/lib/messaging-kpis.functions.ts` | `getMessagingKpis` | 3 × SELECT agregado | Não |
| 2 | `public.message_logs_guard_scope()` (trigger `message_logs_guard_scope_trg`) | validação `clients.brand_id = message_logs.brand_id` | BEFORE INSERT/UPDATE | Não insere |
| 3 | `tests/message-logs-scope.integration.test.ts` | seeds da suíte 10B | INSERT (limpos no teardown) | Sim (teste) |
| 4 | Seed/demo histórico (não versionado no repo) | — | INSERT | Sim (histórico) |

Resultado central da auditoria: **hoje não existe nenhum produtor de aplicação**
(server function, server route, worker, cron, webhook, RPC ou trigger) que
insira em `message_logs`.

Confirmações relacionadas:

- `src/lib/message-templates.functions.ts` → `sendTestMessage` envia e-mail real
  via Resend e devolve preview de WhatsApp, mas **não registra nada** em
  `message_logs`. É o único caminho de envio real existente.
- WhatsApp (Evolution / Cloud API) existe apenas como **credencial** em
  `src/lib/connections.functions.ts` (`whatsapp_evolution`, `whatsapp_cloud`) e
  como rótulo de KPI. Não há client HTTP, worker, cron ou webhook de envio.
- `src/lib/notifications.functions.ts` grava só em `notifications`; a tela
  `settings.notifications.tsx` afirma explicitamente que e-mail/push/WhatsApp
  não têm envio automático hoje.
- Nenhuma função SQL além do trigger cita a tabela; nenhum endpoint
  `api/public/*` (cron, Meta, hooks) a toca.
- Nenhum produtor usa `supabaseAdmin`/service_role — porque não há produtor.
  Não existe, portanto, superfície atual de bypass de RLS nesta tabela.
- Risco de `client_id` vindo do frontend: **não existe caminho de escrita pela
  UI**. O leitor (`getMessagingKpis`) já revalida com `assertBrandMember` +
  `resolveScopedClientIds`, e o trigger + RLS de INSERT rejeitam par
  `brand_id`/`client_id` inconsistente.

## 3. Classificação A/B/C/D

| Fluxo | Classe | Justificativa |
|---|---|---|
| `sendTestMessage` (teste de template/conexão) | **A — workspace level** | Credencial da agência, destinatário digitado pelo operador, sem vínculo com cliente. Se passar a logar, deve logar com `client_id NULL`. |
| Envio real de notificação a contato de cliente (WhatsApp/e-mail transacional) | **B — client level** | Não implementado ainda; quando existir, o `client_id` é determinístico (a mensagem nasce de `clients` / `client_members` / portal). Deve ser obrigatório. |
| Trigger `message_logs_guard_scope` | **A** (infra) | Validação, não produz linha. |
| Seeds da suíte 10B | **A** | Fixtures controladas, apagadas no teardown. |
| 20 linhas históricas | **D — legado/demo** | Ver seção 4. |
| Ambíguos | **C — nenhum** | Não há fluxo real em produção hoje que fique ambíguo. |

## 4. Os 20 registros com `client_id NULL`

- Total da tabela: **20 linhas — 100% com `client_id NULL`**.
- `brand_id` único: `60fce5a7-1859-4bbd-a887-9018ed7f17b5`.
- Janela: `2026-07-13 02:26` → `2026-07-15 08:26` (UTC), em blocos de 6h,
  todos com `sent_at` idêntico ao lote — assinatura de dados gerados por script.
- `provider_message_id` no formato sintético `msg_<10 hex>`.
- `metadata` sempre `{ template: "notif_geral", client: "<nome>" }` — um único
  template fictício, inexistente no catálogo real (`message-templates.catalog.ts`).
- Canais misturados de forma inconsistente (`channel: email` com
  `recipient: +5511987650000` e vice-versa), o que confirma origem de demo.
- Status: `sent` / `delivered` / `failed` (`error_message: invalid_number`).
- Origem/produtor: **seed/demo**, não rastreável a código versionado.
- Inferência de cliente: existe apenas `metadata.client` com os nomes
  "Estúdio Lumina" e "Verde Vivo Nutrição", que **casam por nome** com dois
  clientes da marca. Nome não é relacionamento determinístico → proibido usar.
- Conclusão: **classe D. Devem permanecer `client_id NULL` e intactos.**
  Ficam visíveis apenas para ADMIN do workspace e SUPER ADMIN, o que é o
  comportamento desejado.

## 5. Respostas diretas

- **Produtores que precisam passar `client_id`:** nenhum hoje. Futuramente, todo
  envio transacional originado de um cliente (aprovações, pauta, briefing,
  portal, SLA de cliente) — classe B.
- **Produtores que podem continuar NULL:** teste de template/conexão e eventos
  de sistema da marca — classe A.
- **Ambíguos:** nenhum.
- **Usam service_role/supabaseAdmin:** nenhum.
- **Risco de aceitar `client_id` do frontend:** nulo no estado atual; já coberto
  por trigger + RLS + guards do leitor.

## 6. Proposta para a FASE 10C.2

1. **Não** popular os 20 registros legados; manter `client_id NULL` e a RLS atual.
   Opcional: `COMMENT` documentando que linhas NULL são workspace-level/legado.
2. Criar um **único ponto de escrita** (`src/lib/messaging-log.server.ts`,
   `logMessage(...)`), obrigando o chamador a declarar explicitamente o escopo:
   `{ scope: "workspace", brandId }` ou `{ scope: "client", brandId, clientId }`
   — sem default e sem fallback.
3. Ligar `sendTestMessage` a esse helper com `scope: "workspace"` (classe A),
   passando `brandId` já validado por `assertBrandMember`.
4. Quando surgir envio real por cliente, derivar `clientId` somente do registro
   de origem (post/approval/briefing/portal token) e nunca do contexto ativo do
   frontend; validar com `assertClientScope` antes de gravar.
5. Manter escrita com o client autenticado (RLS ativa). Se algum worker precisar
   de service_role, exigir `assertClientScope` explícito antes do bypass.
6. Só considerar `client_id NOT NULL` se, no futuro, todo produtor for classe B —
   hoje isso é inviável porque a classe A é legítima.
7. Estender `tests/message-logs-scope.integration.test.ts` com casos do helper
   (workspace vs client, e rejeição de `clientId` de outra marca).

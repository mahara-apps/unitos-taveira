# Aprovação de pauta pelo cliente: corrigir envio + notificar a equipe

## O que está acontecendo (verificado)

**1. Causa confirmada do erro no link do cliente**

A regra de negócio grava o status `client_rejected` na pauta, mas o banco não aceita esse valor:

```text
monthly_plans_status_check → status IN
('draft','pending_client','client_approved','changes_requested','approved','archived')
```

Ou seja: sempre que a decisão do cliente resulta em "nenhum item aprovado" (rejeição total, ou revisão item por item sem nenhum aprovado), o `UPDATE` é recusado pelo banco, o servidor devolve `decision_failed` e a tela mostra a mensagem genérica **"Não foi possível registrar sua resposta."** — exatamente a do print.

**2. Dois agravantes encontrados no mesmo fluxo**

- As atualizações item a item (`monthly_plan_topics.client_status/client_comment`) são executadas sem checar erro. Se falharem, a falha é silenciosa; se o passo seguinte falhar, a pauta fica em estado parcial. Na pauta enviada hoje (`pending_client`, 34 temas), nenhum tema tem decisão gravada.
- A tela pública só traduz 4 códigos de erro. Códigos como `decision_failed`, `plan_not_found`, `plan_has_no_topics` e token inválido/expirado caem todos na mesma mensagem genérica, o que impede o cliente (e a equipe) de saber o que houve.

**3. Notificação de ajustes: hoje não existe**

A decisão do cliente **não gera nenhuma notificação**. Nada é inserido em `notifications`, então nada aparece no sino nem em `/notifications`.

Hoje o feedback só é visível se alguém abrir a tela interna da pauta (Cliente → Pauta), onde já aparecem:
- banner de status com "Feedback do cliente: …";
- comentário por tema no card ("…").

## Rota de correção

### A. Destravar o envio

1. Migration mínima ampliando a restrição de status de `monthly_plans` para aceitar `client_rejected` (mantendo todos os valores atuais). Sem recriar tabela, sem tocar em RLS/grants.
2. Passar a checar o erro de cada atualização de tema e abortar com erro claro em vez de seguir adiante silenciosamente.
3. Ampliar o dicionário de mensagens da tela pública (e do portal) para cobrir todos os códigos: pauta já respondida, pauta sem temas, link inválido/expirado/revogado, falha ao registrar. Mensagem sempre acionável ("solicite um novo link à agência", etc.).

### B. Notificar a equipe com os dados do ajuste

Ao registrar a decisão, criar notificação para os responsáveis da marca/cliente (quem criou a pauta + owners/admins/managers com acesso àquele cliente), usando a infraestrutura existente (`notifications` + dedupe por pauta/decisão):

- **kind**: `approval_decision`
- **título**: "Cliente aprovou a pauta" / "Cliente pediu ajustes na pauta" / "Cliente rejeitou a pauta"
- **corpo**: contagens (X aprovados · Y com ajuste · Z rejeitados) + o comentário geral do cliente
- **link**: tela interna da pauta do cliente, já posicionada nos cards com os comentários por tema
- **payload**: id da pauta, cliente, contagens e modo da decisão

Resultado: a notificação aparece no **sino** (pendentes) e na tela **/notifications**, respeitando escopo por workspace e as preferências de notificação já existentes.

### C. Reforço visual na tela interna da pauta

Contadores de decisão do cliente no cabeçalho (aprovados / ajustes / rejeitados) para leitura imediata, mantendo o banner e os comentários por tema que já existem.

## Detalhes técnicos

- `supabase/migrations/*`: `ALTER TABLE public.monthly_plans DROP CONSTRAINT monthly_plans_status_check` + recriação incluindo `client_rejected`. Nenhuma alteração de RLS, grants, tenants ou instalação.
- `src/lib/monthly-plan-decision.server.ts`: checagem de erro nas atualizações de temas; após o update do plano, disparo best-effort das notificações (falha de notificação não invalida a decisão do cliente, mas é registrada).
- Notificações via helper existente de dedupe (`src/lib/notifications-dedupe.ts`), destinatários resolvidos por `brand_members`/`client_members` + `created_by` da pauta.
- `src/routes/pauta.$planId.tsx` e `src/components/portal/portal-pauta.tsx`: mapa completo de mensagens de erro.
- `src/components/monthly-plan/monthly-plan-view.tsx`: contadores da decisão do cliente.
- Testes: decisão total rejeitada (antes falhava), item por item misto, feedback obrigatório, idempotência (pauta já respondida) e criação/dedupe das notificações. Ao final: typecheck, suíte e build.

Sem mudanças em RBAC, RLS, auth, tenants/workspaces, arquitetura de instalação ou migrations históricas.

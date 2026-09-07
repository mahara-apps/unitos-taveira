# Regras por cliente: aprovação do cliente e limite de produção

Dois ajustes por cliente, sem mexer no que já funciona:

1. **Aprovação do cliente por etapa** — pauta, conteúdo e agenda/data podem ser dispensadas individualmente. Cliente que dispensa: o time avança direto, sem esperar ninguém.
2. **Limite de produção do cliente** — separa "escopo de contrato" (a volumetria do briefing, que continua informativa) de "bloquear" (o que trava de fato). Cada cliente escolhe se o limite só avisa ou bloqueia, e em quais frentes (pauta por IA e/ou criação manual).

Quem configura: Owner e Admin. Manager e Usuário veem a regra, não alteram.

## O que muda na tela

Nova seção **Regras do cliente** na aba Produção da ficha do cliente:

- Três interruptores de aprovação: **Pauta**, **Conteúdo**, **Agenda/data**. Cada um mostra hoje "Cliente aprova" ou "Time avança direto".
- Limite de produção: **Só avisar** ou **Bloquear**, e onde bloquear (pauta por IA, criação manual).
- Ao desligar uma aprovação com itens já aguardando o cliente, abre uma confirmação: "3 pautas e 8 conteúdos estão aguardando o cliente" → *Liberar agora* ou *Manter aguardando*. Nada é liberado sem essa escolha.
- Cada card de aprovação e o Kanban ganham um selo discreto quando a etapa está dispensada, para o time entender por que não há espera.

## Como o fluxo passa a funcionar

```text
Pauta      aprovação interna ──> [cliente aprova?] ── sim ─> aguardando cliente ─> produção
                                                   └─ não ─> produção (direto)
Conteúdo   revisão interna   ──> [cliente aprova?] ── sim ─> aprovação do cliente ─> pronto
                                                   └─ não ─> pronto (direto)
Agenda     aprovação interna ──> [cliente aprova?] ── sim ─> cliente decide a data ─> data reservada
                                                   └─ não ─> data reservada (direto)
```

O portal do cliente nunca mostra uma aprovação que ele não deve dar: as listas de pendências, os avisos, o e-mail/WhatsApp e o contador de aprovações passam a respeitar a mesma regra. Links públicos de aprovação (por token) continuam funcionando para o que ainda exige cliente; para etapa dispensada, o link não é gerado.

## Detalhes técnicos

Banco (migration nova, tudo com padrão compatível com o comportamento atual):

- `public.clients`: `approval_policy jsonb not null default '{}'` com as chaves `plan | content | schedule`, cada uma `client` (padrão de hoje) ou `internal`; `scope_policy jsonb not null default '{}'` com `mode` (`warn | block`) e `applies` (`["ai"]`, `["ai","manual"]`).
- `brands` ganha os mesmos dois campos como padrão do workspace; ausência no cliente herda do workspace, e a ausência no workspace mantém o comportamento histórico (`client` / `block` só na pauta por IA). `clients.overage_policy` e `brands.overage_policy` continuam sendo lidos como fallback — nada de dado existente é perdido.
- Trigger `updated_at` já existente; RLS: escrita dos dois campos apenas para Owner/Admin do workspace (checagem via `app_access_role`), leitura pelo escopo atual do cliente.

Servidor:

- Novo `src/lib/client-policy.server.ts`: `resolveClientApprovalPolicy` e `resolveClientScopePolicy` (cliente → workspace → padrão histórico), fonte única para todos os pontos.
- `src/lib/plan-overage.server.ts`: `resolveOveragePolicy` passa a derivar de `scope_policy` mantendo a assinatura atual; nova checagem `enforceScopeOnManualCreate` usada em `content.functions.ts` na criação de post/card quando `applies` inclui `manual` (com o mesmo caminho de liberação de excedente e bypass de Owner/Admin já existentes).
- `monthly-plans.functions.ts` (liberar para o cliente) e `monthly-plan-decision.server.ts`: quando `plan = internal`, a aprovação interna grava `status = approved`, registra a dispensa (`client_decision_mode = 'internal_waived'`) e materializa os tópicos pelo mesmo caminho já usado hoje na aprovação do cliente — sem token, sem `pending_client`.
- `schedule-approval.server.ts`: quando `schedule = internal`, `internalApproveSchedule` grava `reserved` em vez de `client_pending`.
- `content.functions.ts` / aprovação de conteúdo: quando `content = internal`, aprovação interna é terminal; `enables_approval_link` e `createApprovalTokenFn` recusam gerar link para etapa dispensada.
- `portal-data.server.ts`, `portal-pauta.functions.ts`, `portal-schedule.functions.ts`, dashboards e `client-comms.server.ts`: filtram pendências e notificações pela política, para não pedir ao cliente o que foi dispensado.
- Nova função de gravação `setClientPolicyFn` (Owner/Admin) que retorna a contagem de itens aguardando o cliente antes de aplicar e, na confirmação, libera os pendentes pelo caminho oficial de aprovação, com autor e motivo registrados.

Testes e verificação:

- Unitários: resolução de política (cliente/workspace/padrão), pulo de etapa nas três frentes, bloqueio manual ligado/desligado, bypass de Owner/Admin, portal não exibindo etapa dispensada, compatibilidade com `overage_policy` legado.
- Regressão do fluxo completo: gerar pauta → aprovar internamente → produção; agenda; conteúdo; portal do cliente com e sem aprovação; excedente com `warn` e `block`.
- `tsgo`, testes focados e build; validação no navegador autenticado das telas de Produção, Kanban, Calendário e portal.
- Regeneração dos deltas de instalação e `MASTER_RELEASE_VERSION` para `1.0.8`, para a Taveira e futuras instalações receberem a mesma regra.

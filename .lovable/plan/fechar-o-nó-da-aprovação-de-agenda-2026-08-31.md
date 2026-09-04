# Fechar o nó da aprovação de agenda

## O que acontece hoje (verificado no código)

- "Aprovar" na agenda só muda o estado da peça para "aguardando o cliente" (`client_pending`) e registra quem aprovou. **Nada é enviado**: não gera link, não manda e-mail, não cria notificação. O toast "Agenda enviada para o cliente confirmar" descreve uma intenção que o sistema não cumpre.
- O cliente **só veria** essas datas se já tiver o link do Portal (existe 1 link ativo por cliente, criado na área de Clientes/Time) e abrir a aba Calendário — lá o painel de agenda já lista as propostas e permite confirmar ou pedir outra data.
- Não existe hoje nenhum caminho para reservar a data **sem** passar pelo cliente: o estado "reservado" só é alcançado pela decisão do cliente no Portal.

## O que será implementado

### 1. Link do cliente visível no momento da aprovação
- Ao aprovar a agenda, o sistema garante/reutiliza o link ativo do Portal daquele cliente e devolve a URL completa do calendário.
- O painel de agenda passa a mostrar um bloco fixo "Link do cliente" com a URL, botão **Copiar link**, botão **Abrir** e a validade do link. Sem envio automático de e-mail ou WhatsApp.
- Se o cliente ainda não tiver link ativo, o sistema cria um e avisa no próprio bloco.
- O toast passa a dizer o que de fato aconteceu: "Agenda aprovada — envie o link do Portal para o cliente confirmar", com ação "Copiar link".

### 2. Reservar direto, sem o cliente (Owner e Admin)
- Novo botão **Reservar sem cliente** no painel de agenda (individual e em lote), que leva a peça direto para "Data reservada", registrando autor e horário da reserva.
- Disponível apenas para Owner e Admin do workspace; para Manager/User o botão não aparece e a ação é recusada no servidor.
- Continua sem publicar e sem agendar na fila real: reservar apenas fixa a data.

### 3. Retorno da decisão do cliente
- Quando o cliente confirma ou pede outra data no Portal, a operação recebe notificação no sino (dedupada), com o título da peça e a data proposta.
- O painel destaca as peças em "cliente pediu outra data" junto do comentário deixado.

### 4. Legendas coerentes de estado
- Estados exibidos: Agenda sugerida → Aguardando o cliente → Data reservada / Cliente pediu outra data. "Aguardando o cliente" ganha tooltip explicando que a confirmação acontece no Portal pelo link.

## Detalhes técnicos

- `src/lib/schedule-approval.server.ts`: `internalApproveSchedule` passa a devolver também o link do Portal do cliente (reutilizando a tabela `portal_tokens`, 1 ativo por cliente, mesma lógica já usada na administração de clientes); novo `reserveScheduleDirect` gravando `schedule_status = 'reserved'` + carimbo de reserva, com verificação de papel via `app_access_role(user, brand)` restrita a `owner`/`admin`.
- `src/lib/schedule-approval.functions.ts`: nova `reserveScheduleFn` (autenticada, valida escopo brand/client) e retorno do link em `approveScheduleFn`.
- `src/components/calendar/board/schedule-approval-panel.tsx`: bloco "Link do cliente" com copiar/abrir, botão "Reservar sem cliente" condicionado ao papel, destaque para pedidos de alteração e comentário do cliente.
- `src/lib/portal-schedule.functions.ts`: ao registrar a decisão do cliente, dispara notificação interna usando o utilitário de dedupe existente (`src/lib/notifications-dedupe.ts`), best-effort — falha de notificação não invalida a decisão.
- Sem migration: as colunas de agenda (`proposed_at`, `schedule_status`, aprovação/decisão/comentário) já existem. Sem mudança em RLS: todas as escritas continuam pelo cliente autenticado do usuário.
- Testes: papel autorizado/negado em `reserveScheduleDirect`, transição `proposed → client_pending` com link, `client_pending → reserved` pelo Portal e pela reserva direta.

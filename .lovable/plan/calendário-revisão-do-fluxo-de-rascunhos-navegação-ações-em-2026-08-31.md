# Calendário — revisão do fluxo de rascunhos (navegação + ações em massa)

## Problema hoje

- Cada rascunho é editado isoladamente: abrir o wizard, salvar, fechar, procurar o próximo na lista. Para 20 rascunhos são 20 ciclos completos.
- O painel "Rascunhos" mostra apenas 4 itens e não permite seleção múltipla.
- Informações repetitivas (conta/canal/formato, hashtags, horário) são digitadas peça por peça, mesmo quando são idênticas para o mês inteiro.

## O que vamos entregar

### 1. Fila de rascunhos dentro do modal (setas ← →)

Ao abrir um rascunho pelo calendário, o modal passa a conhecer **a fila completa de rascunhos** do cliente (mesma ordem da lista).

- Cabeçalho do wizard: `Rascunho 3 de 12` com setas anterior/próximo e atalhos de teclado (Alt+← / Alt+→).
- Botão principal ganha variante **"Salvar e próximo"**, que grava o rascunho atual e já carrega o seguinte sem fechar o modal.
- Se houver alteração não salva ao navegar, aparece confirmação (Salvar e continuar / Descartar / Cancelar).
- A troca de peça reaproveita a hidratação já existente (`loadPostStateFn`), sem recriar o modal — mídia, destinos, hashtags e agenda continuam vindo do banco.
- Um contador de progresso mostra quantos rascunhos da fila já têm destino e data definidos.

### 2. Seleção múltipla de rascunhos

- Painel "Rascunhos" e a bandeja "Sem data ainda" ganham checkbox por item, com "selecionar todos os visíveis".
- Nova gaveta **"Rascunhos"** (abre por "Ver todos") com a lista completa, filtros por canal/mídia/sem data e a mesma seleção.
- Barra de ação fixa aparece com a contagem: `8 selecionados`.

### 3. Aplicação em massa

Diálogo "Aplicar em massa" com campos opcionais — só o que for marcado é alterado:

- **Destinos**: escolher conta(s) vinculadas ao cliente + canal + formato (feed, stories, reels, carrossel). Modo "substituir" ou "adicionar aos existentes".
- **Agenda proposta**: distribuir automaticamente nos melhores horários (reaproveita a sugestão por persona + histórico já implementada) ou definir dia da semana + hora fixa; nunca sobrescreve data já reservada, a menos que a opção "sobrescrever" seja marcada.
- **Hashtags / primeiro comentário**: acrescentar ao final.
- **Enviar para produção**: mover o lote de `idea` para o estágio seguinte do pipeline.

O resultado é um resumo item a item (aplicado / ignorado / erro com motivo), sem interromper o lote quando uma peça falha.

## Regras preservadas

- Nada publica automaticamente. O lote grava rascunho ou **agenda proposta**; a reserva de data continua passando pela aprovação interna/cliente existente.
- Validação de destino inalterada: conta precisa estar ativa e vinculada ao cliente; destino inválido é recusado com motivo.
- RBAC/RLS/auth atuais mantidos — nada de novo acesso, nada de admin client.
- Fuso `America/Sao_Paulo` em toda distribuição de horários; armazenamento em UTC.

## Detalhes técnicos

- `src/lib/scheduling-wizard.functions.ts`: nova `bulkUpdateDraftsFn` (`requireSupabaseAuth`, escopo brand+client, `postIds` limitado a 100) que reaproveita a validação de destinos de `saveScheduledPostFn` e retorna `{ postId, status, reason }[]`.
- Distribuição de horários chama a lógica já existente de `schedule-suggest.server.ts` / `client-best-times.server.ts`; nenhuma regra nova de melhor horário.
- `src/components/calendar/schedule-wizard/index.tsx`: novas props `queue?: string[]`, `queueIndex?: number`, `onQueueChange?`; a hidratação passa a reagir ao `postId` corrente em vez de só ao seed.
- `src/routes/_authenticated/calendar.tsx`: estado de seleção (`Set<string>`), fila derivada de `draftsQ`/`undatedQ`, abertura do wizard com índice.
- Novos componentes: `src/components/calendar/board/drafts-drawer.tsx` e `src/components/calendar/board/bulk-apply-dialog.tsx`.
- `operations-panel.tsx` e `undated-tray.tsx` recebem props opcionais de seleção (comportamento atual preservado quando não passadas).
- Validação: `tsgo --noEmit`, testes existentes de agenda/wizard + novo teste unitário de distribuição/idempotência do lote, e build.

# Conteúdo, Pauta e Calendário: uma única informação de agenda

## O que está acontecendo hoje (verificado)

A pauta já grava tudo certo no post ao materializar: `channels`, `format`, `proposed_at` e `schedule_status`. Conferido no banco: os posts vindos das pautas do cliente estão com `channels = {instagram}`, `format = reels/feed/stories`, `proposed_at` preenchido e `schedule_status = reserved`, mas `scheduled_at` nulo (correto — reserva não publica).

O problema é só do lado da aba **Conteúdo**:

- A leitura do board (`loadBoardFn`) nem seleciona `proposed_at`, `schedule_status`, `schedule_approved_at` ou `schedule_client_comment` — essas colunas não chegam à tela.
- Card do Kanban e a lista mostram data **apenas** quando existe `scheduled_at`. Como a agenda aprovada vive em `proposed_at`, o conteúdo aparece "sem data" enquanto o calendário mostra a mesma peça datada e reservada.
- O calendário já usa data efetiva (`scheduled_at ?? placement ?? proposed_at`) e rótulos "Agenda sugerida"/"Data reservada". A aba Conteúdo não conhece esses estados.
- Datas na aba Conteúdo são formatadas com `toLocaleString("pt-BR")` sem fuso fixo, enquanto o calendário usa `America/Sao_Paulo`. Isso pode deslocar o dia em horários de borda.
- O modal da peça edita direto `scheduled_at`, criando uma segunda verdade paralela à agenda aprovada.
- Canal/formato só aparecem quando existem; peças antigas criadas fora da pauta continuam sem eles (esperado), então a tela precisa deixar isso explícito em vez de exibir só "—".

## O que vai ser feito

### 1. Uma fonte única de agenda
Criar um helper compartilhado (`src/lib/post-schedule-display.ts`) que, dado um post, devolve:
- data efetiva = `scheduled_at ?? proposed_at`;
- estado da agenda = Sem data / Agenda sugerida / Aprovada internamente / Aguardando cliente / Cliente pediu alteração / Data reservada / Publicação agendada / Publicado;
- rótulos em pt-BR, sempre no fuso `America/Sao_Paulo`, reaproveitando `src/lib/timezone.ts` e os tokens de `src/lib/publication-status-tokens.ts` já usados pelo calendário.

Calendário e Conteúdo passam a derivar rótulo e data do mesmo helper.

### 2. Board de conteúdo passa a carregar a agenda
`loadBoardFn` seleciona `proposed_at`, `schedule_status`, `schedule_approved_at`, `schedule_client_comment` e esses campos entram no tipo `BoardPost`.

### 3. Card do Kanban e lista
- Data efetiva sempre visível, com um selo curto indicando a natureza (sugerida / reservada / agendada / publicada) — mesma paleta do calendário.
- Canal e formato continuam como chips; quando faltarem, mostrar um aviso discreto "definir canal/formato" em vez de "—", porque sem isso a peça não pode ir ao calendário nem publicar.
- Ordenação das colunas e da lista passa a usar a data efetiva (não só `scheduled_at`).
- Coluna "Postagem" da lista mostra data + estado.

### 4. Modal da peça (task-dialog)
- Novo bloco "Agenda": data efetiva, estado, quem aprovou internamente e comentário do cliente quando houver.
- Quando a peça tem agenda vinda da pauta (`schedule_status` diferente de `none`), a edição de data passa a atualizar a proposta pelas funções já existentes (`updateScheduleSlotFn` / `clearScheduleSlotFn`), em vez de escrever `scheduled_at` por fora. Assim editar no Conteúdo e editar no calendário alteram o mesmo dado.
- Peças sem vínculo de agenda mantêm o comportamento atual de agendamento de publicação.
- Botão para abrir a peça no calendário no mês correspondente.

### 5. Consistência de exibição
Substituir os `toLocaleString("pt-BR")` de data de agenda na aba Conteúdo pelos formatadores com fuso fixo, alinhando com o calendário.

## Fora do escopo
- Nada de mudança em RBAC, RLS, auth, publicação automática ou no fluxo de aprovação do Portal.
- Sem migration: as colunas necessárias já existem.
- Não vamos preencher `scheduled_at` a partir de reserva (reserva continua reservando data, não publicando).

## Validação
- `bunx tsgo --noEmit`, testes de agenda/pauta e build.
- Conferência com os dados reais: as peças de pauta reservadas devem exibir a mesma data e o mesmo estado na aba Conteúdo e no calendário.

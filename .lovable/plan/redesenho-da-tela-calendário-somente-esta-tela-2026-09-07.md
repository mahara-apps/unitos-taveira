# Redesenho da tela Calendário (somente esta tela)

Só a página do Calendário muda. Sidebar, cabeçalho, tema, rotas e componentes
globais ficam intactos, e tudo continua ligado aos dados reais.

## Estrutura nova da tela

- **Barra superior**: busca por título (atalho Cmd/Ctrl+K), seletor de visão
  (Calendário · Lista · Painel), e — só na visão Calendário — Semana/Mês ao
  lado. À direita: seta anterior, "Hoje", seta seguinte e botão "Novo".
- **Subbarra**: título do período ("Setembro 2026"), chips de canal com
  contagem, e — só na visão Calendário — densidade Compacto/Confortável e a
  legenda de status fixa.
- **Filtros** (status, canal, formato) continuam disponíveis, recolhidos na
  subbarra para não competir com o conteúdo.

## Card de post (o ponto central)

Sempre nesta ordem: título em 1–2 linhas → miniatura pequena da arte (ou um
retângulo neutro discreto quando não houver, nunca ícone de imagem quebrada) →
horário, canal e formato. O status aparece **uma única vez**: faixa colorida à
esquerda + uma pill pequena. Nada de status como texto no lugar do título.

## As quatro visões

1. **Mês** — 7 colunas (Dom–Sáb), 5–6 semanas, dias de outros meses
   esmaecidos, hoje destacado, até 2 cards por dia e "+N mais".
2. **Semana** — planner de 7 colunas com cabeçalho (dia, número, contagem,
   hoje destacado) e cards empilhados; coluna vazia mostra "Nada agendado" e
   um botão "Agendar". O conteúdo de resumo que hoje aparece aqui sai daqui.
3. **Lista** — agrupada por data, com cabeçalho de grupo (dia + data +
   contagem) e linhas: faixa de status, miniatura, título, meta
   "horário · canal · formato" e pill à direita.
4. **Painel** — quatro cartões de resumo: Próximas publicações, Precisam de
   atenção, Falhas recentes e Rascunhos (número grande + itens), usando os
   painéis operacionais que já existem.

## Detalhe do post

Modal em duas colunas: à esquerda pill de status, título, "Agendado para"
(data e hora no fuso oficial), "Destino" (canal + formato), legenda com
contador de caracteres e as ações **Editar conteúdo**, Aprovar, Duplicar,
Remarcar; à direita a pré-visualização estilo Instagram, com
"Sem arte anexada" e "+ Adicionar mídia" quando não houver arte. Fecha no X ou
clicando no fundo.

## Cores de status (7 rótulos)

Rascunho, Data reservada, Aguardando aprovação, Agendado, Publicado, Sugerido
pela IA, Falhou. Os estados extras do sistema são agrupados nesses 7
("Aprovado sem agenda" → Data reservada; "Publicando" → Agendado; "Parcial" →
Falhou; "Cancelado" → Rascunho). As cores que você passou entram como
referência, ajustadas para ficarem legíveis no tema claro e no escuro.

## Nada se perde

Continuam funcionando, com a mesma rota `/calendar`: assistente de
agendamento (Novo e editar), filtros, datas comemorativas e compromissos,
bandeja de itens sem data, fila de rascunhos, aprovação de agenda e ações em
lote, republicar destino com falha e cancelar agendamento. Onde um recurso não
couber na nova barra, ele passa a um menu/gaveta na própria tela — nunca é
removido. Se algum encaixe ficar conflitante, eu aviso antes de mexer.

## Detalhes técnicos

- Reescrever `src/routes/_authenticated/calendar.tsx`: `view` passa a
  `"calendar" | "list" | "board"`, `range` (`week`/`month`) só visível em
  `calendar`, novos estados `query` (busca + atalho) e `density`.
- Novos componentes em `src/components/calendar/board/`: `calendar-toolbar.tsx`,
  `month-grid.tsx`, `week-planner.tsx`, `agenda-list.tsx`, `status-legend.tsx`.
  `OperationsPanel`/`ScheduleApprovalPanel` passam a alimentar a visão Painel.
- `publication-card.tsx`: título em primeiro plano, thumb com placeholder
  neutro, um único sinal de status, variantes de densidade; `PublicationRow`
  reaproveitado na Lista.
- `publication-status-tokens.ts`: adicionar `group` (os 7 rótulos) e mapa
  `STATUS_GROUP`, mantendo os tokens atuais para compatibilidade; tokens de cor
  novos (`--status-*`) em `src/styles.css` com valor claro/escuro.
- `publication-detail.tsx`: layout de duas colunas + prévia, reusando as ações
  existentes; datas via `src/lib/post-schedule-display.ts` e `APP_TIMEZONE`.
- Sem mudança de banco, RLS, RBAC ou server functions.
- Validação: `bunx tsgo --noEmit`, testes de calendário/escopo e build.
- MASTER-first: sem migration nova; elevar `MASTER_RELEASE_VERSION` (1.2.7),
  regenerar o pacote, rodar `bun run master:check`, publicar e autorizar
  "Atualizar" nas instalações.

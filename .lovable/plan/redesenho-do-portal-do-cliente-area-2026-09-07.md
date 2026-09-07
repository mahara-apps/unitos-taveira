# Redesenho do Portal do Cliente (/area/*)

Só a área do cliente muda. Nenhuma rota é removida, renomeada ou desligada; o app da agência fica intacto.

## Avisos antes de começar

- O portal por link (`/portal/$token/*`) usa exatamente a mesma casca e as mesmas telas do `/area/*`. Ele vai herdar o novo visual (nada deixa de funcionar). Se você quiser o link antigo com o visual velho, me avise — hoje eles são a mesma tela.
- As cores que você passou entram como variáveis do portal no arquivo global de estilos (é o único toque fora de `/area`, sem afetar o app da agência).

## 1. Navegação (fim da linha de abas com rolagem)

- Celular: barra inferior fixa com 5 alvos de 44px+ — Início, Aprovar (com contador de pendências), Calendário, Arquivos e Mais.
- Desktop: barra superior enxuta com as abas principais + menu "Mais" (Pauta, Briefing, Minha Marca, Pedidos, Mensagens, Avisos, Minha conta) + Sair. Sem rolagem horizontal.
- "Mais" abre uma folha (bottom sheet no celular, menu no desktop) listando todas as abas restantes que a permissão do cliente já libera. Todos os destinos atuais continuam alcançáveis.
- Cabeçalho: avatar/logo da marca, nome, "por <agência>" e o sino de avisos; título grande da página só onde faz sentido.

## 2. Início: uma tarefa em primeiro lugar

- Saudação + "Você tem X coisa(s) para fazer hoje".
- Cartão-herói azul: "N conteúdos para aprovar" com botão grande "Revisar agora". Sem pendências, o herói vira um estado calmo ("tudo em dia").
- Os 5 KPIs saem; entra um "Resumo" curto: Aguardando você / Agendados / Publicados.
- "Próximas publicações" (até 5 linhas compactas) e "Atividade recente" (curta), com link "Ver tudo" para o calendário.

## 3. Aprovações: lista compacta + tela por peça

- Lista empilhada: miniatura pequena, título em 2 linhas, "Instagram · formato", selo "Aguardando você" e chevron. Sem cards com área de imagem gigante.
- Abas Pendentes(N) / Aprovados / Ajustes / Todos, mais barra de progresso "X de N".
- Tocar num item abre a aprovação de uma peça por vez: no celular, tela cheia com voltar e contador "3 de 32"; no desktop, o mesmo conteúdo em painel.
- Pré-visualização estilo Instagram (cabeçalho da marca, arte, ícones, legenda) e dois botões grandes fixos na base: "Aprovar" (verde) e "Pedir ajustes" (contorno, abre campo de comentário obrigatório).
- Depois de decidir, avança para a próxima peça pendente.

## 4. Calendário: agenda simples, sem briefing interno

- Agenda agrupada por data (Hoje / Amanhã / dia da semana), cada linha com miniatura, título, "horário · Instagram" e selo Agendado / Confirmar / Publicado.
- Aviso pequeno no topo: "N data(s) para confirmar — nada é publicado sem sua aprovação", com atalho.
- Mês continua disponível como alternância Agenda/Mês.
- O detalhe deixa de exibir conteúdo interno da agência (público-alvo, "por quê", racional da pauta); mostra arte, legenda, data/hora, canal e status.

## 5. Regras em todo o portal

- Placeholder neutro quando não há arte (nunca ícone quebrado).
- Linguagem simples, sem termos internos; carregando/vazio/erro com "tentar de novo" em todas as telas.
- Alvos de toque 44px+, ações principais fixas na base, respeito à área segura do celular.

## Detalhes técnicos

- Novos tokens de portal em `src/styles.css` (`--portal-*` para Aguardando #E0A011, Agendado #0EA5E9, Publicado #16A34A, Ajustes #EC4899, primária #2563EB, superfícies e textos), consumidos por classes utilitárias — sem hex solto nos componentes.
- `portal-nav.ts`: as abas ganham `primary: boolean`; `visiblePortalTabs` continua a fonte única e os paths dos dois modos não mudam.
- `portal-shell.tsx`: header enxuto, tab bar inferior de 5 itens, sheet/menu "Mais"; título/descrição de página passam a ser opcionais por aba.
- `portal-tabs.tsx`: `HomeTab` reescrito (herói + resumo + duas listas, mesmas queries já existentes); `ApprovalsTab` vira lista compacta + `ApprovalScreen` (full-screen no mobile via `Sheet`, `Dialog` no desktop) reaproveitando `ApprovalDialog` (mutations, permissões e chamadas mantidas).
- Novos componentes de apresentação: `portal-media-placeholder.tsx`, `portal-status.tsx`, `portal-row.tsx`, `portal-more-sheet.tsx`, `portal-approval-screen.tsx`.
- `portal-calendar.tsx`: visão agenda agrupada por dia e detalhe sem campos internos (apenas ocultação na apresentação; nenhuma server function, permissão, RLS ou query muda).
- Nenhuma rota criada ou removida: `/area/*` e `/portal/$token/*` seguem idênticos; "Mais" é UI, não rota.
- MASTER-first: sem mudança de banco, mas o pacote é regenerado, `delta_version.txt` e `MASTER_RELEASE_VERSION` sobem juntos e `bun run master:check`, typecheck e build são executados no fim.

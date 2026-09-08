# Ajustes finos na área do cliente (/area/*)

Escopo: só as telas do cliente. Nada muda no app da agência, nas rotas, nas permissões ou nas regras de aprovação. Boa parte já existe do redesenho anterior; aqui ficam apenas os ajustes que faltam.

## 1. Navegação

- O menu lateral do computador passa a aparecer a partir de 900px (hoje só a partir de 1024px) e a coluna fica com 244px.
- No topo da coluna: marca do cliente. Depois os itens Início, Aprovações (com o número de pendências ao lado), Calendário, Arquivos e "Mais" — as demais áreas ficam dentro de "Mais", como no celular.
- Na base da coluna: "Sair", junto do botão de recolher (que continua guardando a escolha).
- No celular nada muda: a barra inferior fica exatamente como está.

## 2. Aprovações

- O botão passa a se chamar "Selecionar" (hoje "Selecionar vários").
- A contagem vira "N de 32 selecionados" (32 = total de itens que podem ser decididos) e ao lado fica "Selecionar todos".
- A barra de ações fica fixa acima da barra inferior, com "Aprovar selecionados" (verde) e "Reprovar" (contorno vermelho).
- Quando tudo está marcado, o botão vira "Aprovar todos".
- Aprovação/reprovação parcial ou total continua igual: reprovar pede motivo obrigatório, há confirmação, progresso e resumo no fim.

## 3. Calendário

- Faixa da semana no topo: os sete dias com um pontinho por status, indicando o dia em foco.
- Filtros rápidos: "Tudo / Confirmar / Agendados".
- A lista deixa de ser dobrada por semana e passa a ser um acordeão por dia: título do dia, quantidade e bolinhas de status; abre automaticamente só o próximo dia que precisa de atenção, o resto começa fechado.
- O detalhe segue sem qualquer conteúdo interno da agência.

## Detalhes técnicos

- `portal-nav.ts`: nada muda nos destinos; o desktop volta a usar `splitPortalTabs` para exibir os 4 principais + "Mais".
- `portal-shell.tsx`: breakpoint da coluna passa de `lg:` para uma media query de 900px (utilitário próprio ou variante `min-[900px]:`), largura `w-[244px]`, botão "Sair" no rodapé da coluna reaproveitando a ação de logout já existente, e o mesmo `Sheet` "Mais" do celular reutilizado no desktop.
- `portal-tabs.tsx` (`ApprovalsTab`): apenas rótulos/contagem e a barra fixa (`fixed bottom-[calc(...)]` acima da tab bar); as mutações `api.decidePost`, permissões e invalidações permanecem intactas.
- `portal-calendar.tsx`: `buildWeekGroups`/`openWeeks` substituídos por grupos diários com estado controlado e regra de "próximo dia com pendência aberto"; nova faixa semanal e filtro local (`all | confirm | scheduled`) sobre os itens já carregados por `api.calendar` — sem nova consulta, server function ou migration.
- MASTER-first: sem mudança de banco; o pacote é regenerado, `delta_version.txt` e `MASTER_RELEASE_VERSION` sobem juntos e `bun run master:check`, typecheck e build rodam no fim.

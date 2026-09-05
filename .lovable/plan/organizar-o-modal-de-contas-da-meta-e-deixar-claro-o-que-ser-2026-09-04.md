# Organizar o modal de contas da Meta e deixar claro o que será conectado

## O que está acontecendo

Na tela atual o bloco de conclusão (resumo + escolha de cliente + botões) fica *dentro* da própria
área que rola, colado no rodapé com fundo semitransparente. Como a lista de contas tem altura fixa
própria, o bloco acaba flutuando sobre as linhas — é a sobreposição que aparece na sua captura, com
"Cupim de Sol" aparecendo por baixo dos botões.

E hoje não existe nenhum lugar que mostre, de forma direta, **quais** contas foram ativadas: só uma
frase curta ("1 conta ativada: …") que cresce e se perde quando são várias, mais os interruptores
espalhados por 189 linhas em quatro abas diferentes.

## O que será feito

### 1. Rodapé fixo de verdade, sem sobreposição
O bloco de conclusão sai de dentro da lista e passa a ser um rodapé real do modal: fundo sólido,
borda superior, sempre visível, com a lista rolando acima dele e terminando exatamente onde o
rodapé começa. A área de contas deixa de ter altura fixa e passa a ocupar o espaço disponível da
janela, então nada mais fica escondido atrás dos botões — em telas pequenas os botões empilham em
vez de brigar por espaço com o seletor de cliente.

### 2. Bandeja "Selecionadas" — a resposta para "qual vai ser conectada?"
Acima do rodapé entra uma faixa compacta que lista **todas** as contas ativadas naquele momento,
como etiquetas com a foto/ícone do canal e o nome, cada uma com um "x" para desativar sem precisar
procurar a linha na lista. A faixa mostra a contagem por canal (ex.: "3 selecionadas · 2 Páginas ·
1 Instagram"), recolhe automaticamente quando passa de poucas e abre com um clique. Sem nada
ativado, ela desaparece e o rodapé explica o próximo passo.

### 3. Filtro "Só as selecionadas"
Um atalho ao lado da busca mostra apenas as contas ativadas, para revisar a escolha final sem
rolar a lista inteira. Contas já vinculadas antes continuam identificadas como "Vinculada" e
aparecem separadas das que você acabou de ativar, para não confundir o que é novo com o que já
existia.

### 4. Destino explícito antes de concluir
O texto do rodapé passa a dizer, em uma linha, exatamente o que vai acontecer: quantas contas, para
qual cliente, e o que acontece se concluir sem cliente (ficam no workspace, disponíveis para
vincular depois). Enquanto nenhuma conta estiver ativada, os botões de conclusão continuam
desabilitados com o motivo à mostra.

## Detalhes técnicos

- `src/components/connections/meta-portfolio-dialog.tsx`
  - `MetaPortfolioDialog`: `DialogContent` em grid `rows-[auto_minmax(0,1fr)_auto]`; painel no meio
    com `min-h-0`, rodapé como terceira linha (`bg-background`, `border-t`), fora do container de
    scroll — elimina o `sticky bottom-0` atual (linha 1016) que causa a sobreposição.
  - `MetaAssetsPanel` ganha prop opcional `footer`/`renderFooter` ou passa a expor a seleção via
    callback, para que o rodapé viva no nível do diálogo mantendo o wrapper legado funcionando.
  - `ScrollArea` das quatro abas troca `h-[420px]` por `h-full`/`flex-1` com `min-h-0` no
    `TabsContent`, para a lista respeitar a altura real do modal.
  - Nova subcomponente `MetaSelectionTray` (mesmo arquivo) alimentada por `linkedNow` + estado dos
    toggles, com remoção por etiqueta reutilizando o mesmo handler de toggle já existente.
  - Filtro "só selecionadas": estado local combinado ao `assetQuery` nos memos `visibleFb`,
    `visibleIg`, `visibleThreads`, `visibleAds`.
- `src/lib/meta/assign-completion.ts`: `assignFinishState` passa a devolver também a quebra por
  canal e o nome do cliente escolhido, para a frase do rodapé; regras de habilitar/desabilitar
  inalteradas.
- Zero mudança de backend, RBAC/RLS, migrations ou lógica de vínculo — apenas apresentação,
  seleção visível e layout.
- Testes: casos novos em `tests/meta-assign-completion.unit.test.ts` (resumo por canal, destino
  com e sem cliente) e em `tests/meta-connect-flow.test.ts` (remoção pela bandeja mantém a lista
  de conexões coerente).

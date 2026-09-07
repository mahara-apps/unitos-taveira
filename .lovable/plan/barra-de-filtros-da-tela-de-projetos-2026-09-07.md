# Barra de filtros da tela de Projetos

## O problema

Hoje a faixa de filtros empilha seis controles largos na mesma linha (busca,
status, responsável, cliente ativo, cor do projeto, ordenação) mais o alternador
Cards/Lista empurrado para a direita. Como cada um tem largura fixa, em telas
normais a linha estoura e o alternador cai para baixo, deixando a faixa com o
dobro de altura e o texto cortado — exatamente o que aparece no print.

## Como fica

Mesmo visual de hoje (mesma superfície, mesmas alturas, mesmos ícones e cores),
só reorganizado:

**Linha única, sempre estável**
- Busca ocupando o espaço livre à esquerda.
- Filtro de status ao lado (visível).
- Botão "Filtros" com um contador de quantos filtros extras estão ativos —
  abre um painel com Responsável, Cliente (quando não há cliente ativo),
  Cor do projeto e Ordenação, um por linha, com nomes por extenso.
- À direita, o alternador Cards/Lista, ancorado e sem encolher.

**Cliente ativo**
Continua indicado como hoje (bolinha da cor + nome + "sidebar"), mas em formato
de selo compacto que trunca em vez de esticar a linha.

**Linha de resumo**
A contagem de projetos e os selos removíveis dos filtros aplicados continuam
logo abaixo, iguais, incluindo "Limpar filtros".

**Celular**
Busca em uma linha; status, "Filtros" e Cards/Lista na linha seguinte, sem
quebra torta e sem texto cortado.

## O que não muda

Nada de dados, permissões, consultas, ordenação real, cards, lista, matriz,
rotas ou qualquer outra tela. É trabalho apenas de apresentação dentro da faixa
de filtros de Projetos.

## Detalhes técnicos

- Arquivo único: `src/routes/_authenticated/projects.index.tsx`, bloco
  "Filtros" (aprox. linhas 636-815). Estados (`q`, `statusFilter`,
  `ownerFilter`, `clientFilter`, `colorBy`, `sortKey`, `sortDir`, `view`) e
  handlers permanecem idênticos — apenas mudam de lugar no JSX.
- Container passa de `flex flex-wrap` para
  `grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] items-center`,
  com `min-w-0` nos containers de texto e `shrink-0` nos widgets fixos,
  conforme o padrão responsivo do projeto.
- Painel "Filtros": `Popover` + `Button variant="outline" size="sm"` com
  `Badge` de contagem; reaproveita os `Select` já existentes dentro do
  conteúdo, sem novas dependências.
- `ClientFilterCombobox` e `FilterChip` continuam sendo usados como estão.
- Sem migração de banco. MASTER-first: regenerar o pacote, subir
  `delta_version.txt` + `MASTER_RELEASE_VERSION` para `1.2.12`, rodar
  `bun run master:check`, typecheck e build.

# Área do cliente mais amigável: menu lateral no desktop, calendário por semana e decisões em lote

Escopo: apenas a área do cliente (`/area/*` e o link `/portal/$token/*`, que dividem a mesma casca). Nada muda no app da agência, nas rotas, nas permissões ou nas regras de aprovação.

## 1. Menu lateral retrátil no desktop

- No desktop, o menu passa a ser uma coluna à esquerda, sempre visível, com ícone + nome de cada área e destaque da área atual.
- Um botão encolhe a coluna para só ícones (com dica ao passar o mouse) e a escolha fica lembrada no navegador.
- O topo fica enxuto: marca do cliente, aviso de "somente acompanhamento" quando for o caso e as ações que hoje já existem no cabeçalho.
- Com a lateral, todas as áreas ficam listadas diretamente — o menu "Mais" deixa de ser necessário no desktop.
- No celular nada muda: a barra inferior fixa com 5 alvos e a folha "Mais" continuam iguais.

## 2. Calendário agrupado por semana

- A lista de datas passa a ser dobrada em semanas ("Semana de 8 a 14 de setembro"), cada uma com quantos itens tem e podendo abrir/fechar.
- A semana atual e a próxima abrem automaticamente; as demais começam fechadas, acabando com a rolagem infinita.
- O quadro do mês, a legenda, o detalhe do item e a navegação entre meses continuam como estão.
- Itens sem data continuam num grupo próprio ao final.

## 3. Selecionar vários e decidir em lote

Em **Aprovações**:

- Botão "Selecionar" liga o modo de seleção; cada item ganha uma caixa e existe "selecionar todos os visíveis".
- Uma barra de ação aparece no rodapé com a contagem: **Aprovar selecionados** e **Reprovar selecionados**.
- Aprovação parcial é natural: o cliente marca só o que quer aprovar; "aprovar todos" é a mesma barra com todos marcados.
- Reprovar em lote pede um motivo obrigatório, aplicado a todos os itens escolhidos.
- Confirmação antes de enviar, progresso durante o envio ("3 de 8"), e no final um resumo do que foi aplicado; se algum item falhar, ele permanece selecionado com o aviso do erro.
- O detalhe individual (arte, legenda, aprovar/pedir ajustes) continua exatamente como hoje.

Em **Datas propostas** (dentro do Calendário):

- Mesmo padrão: seleção múltipla e confirmação de várias datas de uma vez, ou pedido de ajuste com um comentário único.

## 4. Cuidados

- Cliente sem permissão de decidir (link somente leitura) não vê seleção nem botões de decisão.
- Cada decisão continua passando pelas mesmas funções de servidor já existentes, uma por item, com as mesmas checagens de permissão e registro de quem decidiu.
- Nenhuma rota, aba ou permissão é removida.

## Detalhes técnicos

- `src/components/portal/portal-shell.tsx`: nova coluna `<aside>` para `lg+` com estado colapsado persistido em `localStorage`; barra inferior mobile e `Sheet` "Mais" intactos; `splitPortalTabs` deixa de ser usado no desktop.
- `src/components/portal/portal-calendar.tsx`: agrupamento `agenda` reescrito em buckets semanais (segunda a domingo, `America/Sao_Paulo` via `src/lib/timezone.ts`), com `<details>`/estado controlado por semana.
- `src/components/portal/portal-tabs.tsx` (`ApprovalsTab`, `ApprovalListItem`): estado `selection: Set<string>`, `selectMode`, barra de ação fixa, diálogos de confirmação (aprovar / reprovar com `note` obrigatório) e execução sequencial de `api.decidePost` com contador de progresso e invalidação de `["portal","approvals"]` e `["portal","metrics"]` no final.
- `src/components/portal/portal-schedule.tsx`: seleção múltipla reaproveitando `api.decideSchedule`, que já aceita `postIds[]`.
- Reuso de `portal-ui.tsx`/`portal-shared.tsx` e dos tokens do portal; sem novas dependências, sem migrations. Se algum utilitário novo for criado, fica em `portal-ui.tsx`.
- MASTER-first: como não há mudança de banco, o pacote é regenerado, `delta_version.txt` e `MASTER_RELEASE_VERSION` sobem para a próxima versão e `bun run master:check` roda antes de fechar.
- Verificação: `tsgo`, build, `/area/inicio` e `/area/calendario` respondendo 200, e captura desktop + mobile para conferência visual.

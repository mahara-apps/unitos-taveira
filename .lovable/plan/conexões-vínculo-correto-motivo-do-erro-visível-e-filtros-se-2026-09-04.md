# Conexões: vínculo correto, motivo do erro visível e filtros sem duplicidade

## 1. Botão "Vincular" da linha inicial da lista

Na linha agrupadora "Sem cliente vinculado" o botão "Vincular" hoje abre o vínculo do **primeiro** canal do grupo (`r.metaChannels[0]`), mesmo havendo 9 canais aguardando — ou seja, sempre vincula o perfil errado.

- Remover esse botão da linha do grupo.
- No lugar, um botão **"Ver canais"** que expande a linha e mostra a lista, onde cada canal já tem seu próprio "Vincular" (comportamento correto, mantido como está).
- Nas linhas de cliente real nada muda ("Conectar" permanece).

## 2. Portfólios com "Erro" sem explicação

O status "Erro" aparece sem dizer do que se trata.

- Adicionar tooltip na etiqueta de status de cada portfólio, com o motivo em linguagem clara:
  - **Erro** (autorização ausente/expirada): "A autorização da Meta para este portfólio não está mais válida. Reautorize mantendo todas as Páginas e contas do Instagram marcadas."
  - **Atenção**: "N conta(s) deste portfólio precisam de atenção" (usa a contagem já existente).
  - **Conectado**: "Autorização válida na última sincronização".
- Quando a sincronização tiver retornado aviso da Meta, a tooltip usa o estado operacional já traduzido (limite temporário, permissão, falha genérica), sem texto técnico cru — o técnico continua só em "Detalhes técnicos".

## 3. Filtros duplicados dentro do portfólio

Ao expandir um portfólio, a tabela interna repete busca, "Filtrar" e ordenação, que já existem acima.

- Esconder busca/filtro/ordenação da tabela interna quando ela é aberta dentro de um portfólio.
- Manter o contador de contas, a paginação e o botão "Sincronizar".
- A tabela de contas usada fora desse contexto (fluxo "Conectar canais") continua com os filtros.

## Detalhes técnicos

- `src/components/connections/clients-channels-table.tsx`: remover o ramo `r.metaChannels[0]` → `actions.onLink(...)` da célula de ações e trocar por expansão da linha (`setExpanded`).
- `src/components/connections/meta-portfolios-panel.tsx`: `StateBadge` passa a receber motivo (`reason`) e renderiza com `Tooltip` do design system; o motivo é calculado a partir de `p.authorized`, `p.attentionCount` e, quando houver, `metaIssueState(...)` de `src/lib/meta/issue-messages.ts`.
- `src/components/connections/available-accounts-table.tsx`: nova prop opcional `hideControls?: boolean` (apenas presentação) que omite o bloco de busca/Filtrar/ordenação; passada como `true` na expansão do portfólio.
- Sem mudanças em banco, RLS, OAuth, descoberta Meta ou lógica de vínculo.

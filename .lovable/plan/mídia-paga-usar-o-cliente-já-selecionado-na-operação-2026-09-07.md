# Mídia paga: usar o cliente já selecionado na operação

## O problema

Ao abrir "Mídia paga" com um cliente ativo na barra de operações e clicar em gerar plano com IA, o modal aparece com o campo de cliente vazio, pedindo para escolher de novo — mesmo que o contexto já diga de quem é a operação.

## O que muda

- Com cliente ativo na operação: o modal já mostra esse cliente preenchido, em destaque e sem possibilidade de troca acidental (linha de leitura com o nome do cliente e um aviso curto de que o plano é dessa operação). O usuário vai direto ao título/período e à entrevista.
- Sem cliente ativo (visão de workspace): nada muda — o seletor de cliente continua aparecendo normalmente e é obrigatório.
- Vale para os dois modos do modal: "Gerar plano com IA" e "Novo plano de mídia" (manual).

## Detalhes técnicos

- `src/routes/_authenticated/media-plans.tsx`: passar `defaultClientId={clientId ?? undefined}` para `CreateMediaPlanDialog` (o `clientId` do `useActiveContext` já é lido nessa tela para o filtro da lista).
- `src/components/media-plans/create-media-plan-dialog.tsx`: quando `defaultClientId` estiver definido, renderizar o campo Cliente como valor fixo (nome resolvido da lista de clientes já carregada) em vez do `Select`; manter o `Select` quando não houver cliente no contexto. O `useEffect` de reset já aplica `defaultClientId`, então a lógica de submissão não muda.
- Nenhuma mudança de dados, permissões ou geração do plano.

# Tela de aprovação do cliente com o layout da pauta do painel

Alvo: a página pública `/pauta/{id}?token=…` (link enviado ao cliente). Hoje ela é uma lista simples de `Card`s em coluna única, com badges neutras, sem hierarquia visual. Vamos alinhá-la ao padrão da pauta gerada no painel — somente visual/apresentação, sem mudar a lógica de decisão nem os endpoints.

## 1. Cabeçalho (bloco "Estratégia")

- Cartão arredondado `rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur`, como a seção de estratégia do painel.
- Nome do cliente em label maiúsculo pequeno, título grande (`text-3xl font-semibold tracking-tight`).
- Descrição e Objetivos em grid de 2 colunas com rótulos em caixa alta discreta (mesmo padrão do painel).
- Linha de resumo com contadores: total de temas, aprovados, com ajuste, rejeitados — usando as mesmas cores (emerald / amber / rose).

## 2. Cards dos temas

- Grid de 2 colunas em telas médias (`grid gap-3 sm:grid-cols-2`), como o painel.
- Borda e fundo por estado, igual ao `TopicCard`: aprovado = emerald, rejeitado = neutro esmaecido, ajuste = amber, pendente = card padrão.
- Badge de status no topo do card com as cores do painel (pill `rounded-md border px-1.5 py-0.5 text-[10px]`).
- Badges de canal e formato coloridas por canal (Instagram, TikTok, LinkedIn, YouTube, Facebook), reaproveitando os rótulos de `PLAN_CHANNEL_LABEL`.
- Blocos "Gancho", "Público-alvo" e "Por quê" com os mesmos rótulos em caixa alta e caixa `bg-muted/40` para o "Por quê".
- Comentário do cliente exibido no mesmo estilo citado do painel.

## 3. Barra de ações

- Ações de decisão (Aprovar pauta inteira / Solicitar ajustes / Decidir item por item / Rejeitar) passam para uma barra fixa no rodapé (`fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur`), espelhando a sticky action bar do painel, com `pb-32` no conteúdo.
- Botão principal com destaque verde; rejeitar em tom destrutivo suave; modos de texto (ajuste/rejeição/item por item) abrem o textarea acima da barra.
- Estado já decidido mostra um banner colorido no topo (emerald / amber / rose) em vez do card neutro atual.

## 4. Estados de carregamento e erro

- Loading vira skeleton com o mesmo formato (título + bloco + grid de cards), em vez do spinner centralizado.
- Card de link inválido mantém a mensagem, com moldura no novo padrão.

## Observações técnicas

- Arquivo afetado: `src/routes/pauta.$planId.tsx`.
- Reaproveitar `PLAN_CHANNEL_LABEL` de `@/lib/monthly-plan-fields` para os rótulos de canal; cores via tokens/utilitários já usados no painel.
- Nenhuma mudança em `monthly-plan-public.functions.ts`, no schema, nem no fluxo de decisão (mesmas mutações e validações).

# Corrigir a soma da volumetria (4/semana = 16/mês)

## Problema confirmado

A cota mensal é calculada multiplicando a meta semanal por um "número médio de semanas por mês":

- `src/lib/monthly-plan-fields.ts` usa `WEEKS_PER_MONTH = 4.3` → 4/sem vira `round(4 × 4.3) = 17`
- `src/components/customer/monthly-plan-dialog.tsx` tem uma segunda constante local, `4.33` → mesmo canal poderia dar outro número em outra tela

Daí os 17 do card "Total do cliente / Instagram" na tela de Pauta, em vez dos 16 esperados.

## Correção

1. Passar a contar **4 semanas por mês** (mês = 4 semanas cheias). `WEEKS_PER_MONTH = 4` em `src/lib/monthly-plan-fields.ts`, com comentário explicando a regra.
2. Remover a constante duplicada `4.33` do `monthly-plan-dialog.tsx` e importar a constante única de `monthly-plan-fields.ts`, para que Briefing, Pauta, wizard de geração, aba Produção e o diálogo mostrem sempre o mesmo número.
3. Como a cota vira multiplicação exata de inteiros, o `Math.round` deixa de arredondar nada — a soma dos canais passa a fechar exatamente com o total do cliente (sem "sobra" de arredondamento).

Nada mais muda: excedentes autorizados, quantidade gerada e o enforcement de cota na geração continuam usando a mesma `monthlyQuota`, agora correta.

## Efeito visível

- Instagram 4/semana → **16/mês**
- Total do cliente = soma exata das cotas por canal
- Peças já geradas (8, no exemplo) permanecem; "disponíveis" passa a 8

## Detalhes técnicos

Arquivos alterados: `src/lib/monthly-plan-fields.ts` (valor da constante) e `src/components/customer/monthly-plan-dialog.tsx` (usar a constante compartilhada). A cota é derivada em runtime em `src/lib/monthly-plan-context.server.ts`, então não há dado persistido a migrar.

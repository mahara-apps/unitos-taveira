# Fechar o wizard após gerar a pauta

## O que acontece hoje

Em `src/components/monthly-plan/monthly-plan-view.tsx`, ao gerar com sucesso o `onSuccess` da mutação apenas chama `setPlanId(res.plan.id)`. O estado `wizardOpen` continua `true`. Enquanto a pauta gerada está na tela o modal não aparece (o bloco de geração deixa de ser renderizado), mas assim que o usuário volta para a lista ("Voltar" / descartar), o wizard reabre sozinho por conta desse estado preso.

## Correção

- No `onSuccess` da mutação de geração, quando `result.ok` for verdadeiro: fechar o wizard (`setWizardOpen(false)`) antes/junto de `setPlanId(...)`, e limpar `generationError`.
- Em caso de erro (`result.ok === false` ou `onError`): manter o wizard aberto exibindo a mensagem, como hoje.
- Em `onBack`/`onDiscarded` da view de aprovação, garantir `setWizardOpen(false)` como salvaguarda.

Nenhuma mudança de lógica de geração, prompt ou banco de dados.

## Arquivo afetado

- `src/components/monthly-plan/monthly-plan-view.tsx`

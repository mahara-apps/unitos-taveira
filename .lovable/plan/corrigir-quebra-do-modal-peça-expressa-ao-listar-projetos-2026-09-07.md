# Corrigir quebra do modal "Peça expressa" ao listar projetos

## Problema

Ao abrir "Peça expressa" e escolher "Projeto existente", a lista de projetos estoura a largura do modal quando o nome do projeto é longo (ex.: "Pauta — Café Aurora: Sabores que Abraçam, Momentos que Iluminam..."). A lista empurra o conteúdo para fora da caixa e quebra o layout — como mostram as capturas.

## Causa

Em `src/components/monthly-plan/pauta-organization-field.tsx`, a lista de projetos (`<ul>` com botões `w-full`) trunca o texto do item, mas o conjunto lista → contêiner → modal não impõe limite de largura em todos os níveis: falta `min-w-0`/`overflow-hidden` no encadeamento, então nomes longos forçam a caixa a crescer além do `max-w-lg` do `DialogContent`. O mesmo componente é usado na criação de pauta, então a correção vale para os dois lugares.

## O que será feito (somente visual, sem mudar funcionalidade)

1. **`pauta-organization-field.tsx`** — blindar a largura em cada nível da lista:
   - Contêiner da lista com `w-full min-w-0 overflow-hidden`.
   - Cada botão de projeto com `min-w-0` e o nome com truncamento garantido (`truncate` + `title={p.name}` para mostrar o nome completo no passe do mouse).
   - Manter busca, seleção, estados de carregando/vazio/erro exatamente como estão.
2. **`quick-post-dialog.tsx`** — garantir que o conteúdo do modal não exceda a caixa (`min-w-0` no corpo), sem mexer em lógica, campos ou validações.
3. **Validação**: typecheck, build, `bun run master:check` e abertura da tela no preview para conferir o modal com nomes longos.

## Fora de escopo

- Nenhuma mudança de dados, regras, permissões ou fluxo de criação.
- Nenhuma mudança em outras telas.

## MASTER-first

Sem alteração de banco (só visual). Ainda assim: regenerar o pacote, alinhar `delta_version.txt` e `MASTER_RELEASE_VERSION` (1.3.4), rodar `bun run master:check`, e deixar publicação/autorização das instalações como passo seu.

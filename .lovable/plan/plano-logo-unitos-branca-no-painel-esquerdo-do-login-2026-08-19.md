# Plano — Logo Unitos branca no painel esquerdo do login

## Objetivo
Adicionar a logo da Unitos (versão branca, fundo transparente) no topo do painel esquerdo (brand panel) da tela de login, acima do texto principal, em destaque.

## Contexto atual
- `src/routes/login.tsx` renderiza um `BrandPanel` com fundo escuro fixo (gradiente `oklch`) e texto branco.
- A logo foi removida em iteração anterior; não há nenhum elemento visual de marca no painel hoje.
- Assets disponíveis em `src/assets/brand/`:
  - `logo-unitos-light.png` — logo branca/ clara, fundo transparente (uso em fundos escuros). **Esta é a correta.**
  - `logo-unitos-dark.png` — logo escura (uso em fundos claros).
  - `mark-unitos.png` — apenas o ícone/mark.
- O painel esquerdo é sempre escuro (não reage ao tema), por isso a escolha da versão light/branca é fixa e independente do `ThemeProvider`.

## Mudança (somente `src/routes/login.tsx`)
1. Importar o asset JSON da logo branca:
   ```ts
   import logoLight from "@/assets/brand/logo-unitos-light.png.asset.json";
   ```
2. No topo do `BrandPanel`, **acima** do bloco `<div className="max-w-md">` que contém o headline, adicionar a logo em destaque:
   - `<img src={logoLight.url} alt="Unitos" />`
   - Altura controlada (ex.: `h-9` / `w-auto`) com `object-contain` e `select-none`.
   - Espaçamento inferior (`mb-10`) para separar do headline.
   - Manter-se dentro do fluxo do painel (sem `absolute`), alinhada à esquerda.
3. Nenhuma alteração em lógica, dados, roteamento ou demais telas.

## Resultado
Painel esquerdo do login com a logo Unitos branca no topo, acima do texto, em destaque sobre o fundo escuro.

## Validação
- Build/typecheck sem erros.
- Verificar visual no preview (desktop): logo visível, branca, com fundo transparente, acima do headline.

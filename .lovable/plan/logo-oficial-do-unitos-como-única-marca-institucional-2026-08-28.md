# Logo oficial do Unitos como única marca institucional

## Problema

Hoje a marca institucional padrão do sistema é um SVG desenhado no código
(`src/components/brand/unitos-wordmark.tsx`): um "U" dentro de um quadrado
arredondado com um ponto embaixo, mais o texto "unitos". Não é a logo oficial.

Esse SVG aparece sempre que não há uma logo personalizada carregada com
sucesso — ou seja, na maioria das instalações novas: tela de login, esqueci
minha senha, redefinir senha e sidebar. É essa a "logo que não é a oficial"
que está aparecendo.

## Correção

1. Registrar o arquivo enviado (`logo_unitos_white_login.png`) como o asset
   oficial do Unitos, recortando o excesso de área transparente para a
   proporção real do wordmark e gerando também uma versão quadrada (ícone)
   para os locais que usam a variante compacta.
2. Trocar o conteúdo de `unitos-wordmark.tsx`: em vez de desenhar o "U"
   inventado, renderizar a logo oficial. Para funcionar em fundo claro e
   escuro com um único arquivo, a logo é aplicada como máscara CSS colorida
   por `currentColor` — assim mantém o comportamento atual de se adaptar ao
   tema, sem precisar de um segundo arquivo.
3. Manter intactas as regras já existentes de `BrandLogo`: proporção
   reservada (zero layout shift), pré-carregamento da logo da instalação e
   volta automática para a logo oficial em caso de falha/URL inválida.
4. Definir a nova logo também como favicon do app, substituindo o ícone atual.
5. Nenhuma outra tela, permissão, RBAC ou lógica de branding é alterada:
   quem tiver identidade visual configurada continua vendo a própria logo.

## Detalhes técnicos

- Asset via `lovable-assets` a partir de `/mnt/user-uploads/`, com pointer
  `.asset.json` em `src/assets/`; favicon como arquivo real em `public/`.
- `UnitosWordmarkGlyph` e `UnitosMarkGlyph` passam a renderizar um `span`
  com `mask-image` apontando para a URL do asset, `background-color:
  currentColor`, `mask-size: contain` e alinhamento herdado do container.
- `UNITOS_WORDMARK_RATIO` passa a refletir a proporção real do arquivo
  recortado (hoje está fixo em 600/180).
- `login-logo.tsx`, `unitos-logo.tsx`, `brand-logo.tsx` e as rotas de login
  continuam sem mudança de API.
- Ao final: typecheck, testes e build.

## Ponto a confirmar

O arquivo enviado é branco. A abordagem por máscara resolve fundo claro e
escuro com um único arquivo. Se você tiver uma versão colorida oficial (com
o "Ü" em cor), me envie que eu uso a colorida em fundo claro e a branca em
fundo escuro.

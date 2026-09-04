# Corrigir troca de logo após o login

## Diagnóstico confirmado

A tela de login e o primeiro render da sidebar mostram o wordmark novo do Unitos (SVG local, preto e atualizado). Depois que o branding da instalação carrega, a UI troca esse SVG pelos PNGs antigos enviados em Identidade Visual.

O singleton `public.installation` tem hoje:
- `logo_url` = `.../logo_light-1784271232997.png`
- `logo_dark_url` = `.../logo_dark-1784271753138.png`
- `login_logo_url` = `.../logo_login-1787233792122.png`
- `icon_url` = vazio

Esses três arquivos são a logo antiga (com tagline). Não é bug de flicker de tema: é a logo configurada sobrescrevendo o SVG novo.

## O que será feito

1. Limpar os três caminhos de logo da instalação (`logo_url`, `logo_dark_url`, `login_logo_url`), zerando os uploads antigos. Sem alterar o schema, RLS, autenticação ou a separação Instalação × Workspace.
2. Com os caminhos nulos, `BrandLogo` já usa o SVG institucional novo em login, recuperação de senha, sidebar e portal — logo consistente antes e depois do login, sem troca visível.
3. Remover também os objetos antigos do bucket `brand-assets` correspondentes a esses três caminhos, para não sobrarem arquivos órfãos.
4. Manter o mecanismo de upload intacto: se um Super Admin enviar uma logo nova no futuro, ela volta a ser usada normalmente.

## Validação

- Conferir no banco que os três campos ficaram nulos.
- Abrir a tela de login e o painel autenticado no navegador e confirmar, por screenshot, que a logo é a mesma nos dois momentos e não muda depois do carregamento.
- Rodar typecheck, testes e build.

## Detalhes técnicos

- Atualização de dados via `UPDATE public.installation SET logo_url = NULL, logo_dark_url = NULL, login_logo_url = NULL`, sem migration de schema.
- Nenhuma alteração em `src/components/brand/*` é necessária: o fallback já é o SVG inline (`UnitosWordmarkGlyph` / `UnitosMarkGlyph`), com dimensões reservadas e sem layout shift.
- Nenhuma mudança em RBAC, RLS, migrations históricas ou arquitetura de tenants.

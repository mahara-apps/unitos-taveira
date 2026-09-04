# Tema claro como padrão + fim do flicker de tema e da troca de logo

## Diagnóstico (verificado no código)

1. **Dark "forçado"**: `src/components/theme-provider.tsx` inicia com `theme = "system"` — se o sistema operacional/navegador está em dark, o app abre em dark sem o usuário ter escolhido nada.
2. **Flicker na tela de auth**: `resolvedTheme` inicia fixo em `"light"` e só no `useEffect` (pós-hidratação) lê o `localStorage`/sistema e chama `applyTheme`. Resultado: a tela renderiza clara e "alguns segundos depois" troca para dark. Não existe script inline no `<head>` que aplique a classe antes do primeiro paint.
3. **Logo troca após o login**: `UnitosLogo` escolhe `logoLight`/`logoDark` conforme `resolvedTheme` e o branding customizado (`useBrandBranding`) carrega URLs assinadas de forma assíncrona. Com o tema resolvendo tarde, o primeiro render usa o fallback institucional/light e depois troca para a logo dark/custom — percebido como "começa com uma logo e muda para outra".

## Mudanças

### 1. `src/components/theme-provider.tsx`
- Tema padrão passa a ser **"light"** (não mais "system"). Dark só entra quando o usuário clicar no toggle — a escolha já é persistida em `localStorage("theme")` e respeitada nos próximos acessos.
- Inicialização **síncrona**: ler `localStorage("theme")` no initializer do estado (guardado para SSR) e calcular `resolvedTheme` já no primeiro render — elimina a troca pós-hidratação.
- Manter a opção "system" funcional caso já esteja salva, mas nunca como padrão de fábrica.

### 2. Anti-flicker no boot — `src/routes/__root.tsx`
- Script inline pequeno no `<head>` (via `head()`/scripts do root) que, antes do paint, lê `localStorage("theme")` e aplica a classe `light`/`dark` no `<html>`. Padrão do script: **light** quando não há escolha salva.
- Isso remove também o flash em hard refresh em qualquer rota pública (login/auth).

### 3. Logo estável — `src/components/brand/unitos-logo.tsx` (e `login-logo.tsx` se aplicável)
- Com o tema resolvido de forma síncrona, a escolha light/dark da logo deixa de oscilar.
- Garantir que, enquanto o branding customizado carrega, o fallback institucional permanece com dimensões reservadas (já existe via `BrandLogo`) — sem swap visual brusco; se o branding custom estiver em cache local, usar como valor inicial para evitar troca pós-login.

### 4. Validação
- `bunx tsgo --noEmit`, testes unitários existentes (boot/theme) e suíte.
- Preview: abrir `/auth` com OS em dark → deve abrir claro; alternar para dark → persiste após reload; login → logo não troca após carregar.

## Fora de escopo / cuidados
- Não remover o dark mode nem o toggle — apenas deixar de forçá-lo como padrão.
- Não alterar tokens de cor, layout da tela de auth ou lógica de branding no banco.
- Pendente do turno anterior (exclusão de cliente com dupla confirmação + restrição a admin): código e migration já aplicados; os testes/validação dessa tarefa serão executados junto com esta.

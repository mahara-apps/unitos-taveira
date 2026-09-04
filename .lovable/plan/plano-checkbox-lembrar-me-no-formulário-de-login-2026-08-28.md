# Plano — Checkbox "Lembrar-me" no formulário de login

## Objetivo
Adicionar um checkbox "Lembrar-me" no formulário de login que controla se a sessão persiste entre reinícios do navegador (lembrar) ou se é apagada ao fechar a aba (não lembrar).

## Comportamento
- **Marcado (padrão):** sessão vai para `localStorage` — permanece logado após fechar/reabrir o navegador.
- **Desmarcado:** sessão vai para `sessionStorage` — ao fechar a aba, o usuário é deslogado.
- A preferência em si é guardada em `localStorage` (sempre persiste), lida em tempo real pelo adaptador de storage.

## Mudanças

### 1. Novo arquivo: `src/integrations/supabase/remember-storage.ts`
Adaptador de storage que envolve o resultado de `brokeredPreviewStorage()`:
- Em produção (base === `localStorage`): lê a flag `unitos:remember-me` (default `true`) a cada `getItem`/`setItem`. Se desativada, redireciona para `sessionStorage`; se ativada, usa `localStorage`. `removeItem` limpa ambos.
- Em preview (base = broker de postMessage): repassa direto ao broker (sem troca — preview é tooling de dev).
- A flag é avaliada em runtime (dentro de getItem/setItem), então respeita a escolha feita no checkbox antes do submit.

### 2. `src/integrations/supabase/client.ts`
Trocar `storage: brokeredPreviewStorage()` por `storage: createRememberStorage()` (importando do novo arquivo). Única alteração funcional; o restante do cliente permanece idêntico.

### 3. `src/components/login-form.tsx`
- Importar `Checkbox` de `@/components/ui/checkbox`.
- Adicionar `rememberMe: z.boolean().default(true)` ao schema `signInSchema`.
- Default do form: ler `localStorage.getItem("unitos:remember-me")` (default `true`) no `defaultValues`.
- Adicionar um `FormField` com `Checkbox` + label "Lembrar-me", posicionado logo após o campo de senha e antes do botão Entrar, em uma linha (`flex items-center gap-2`).
- No `onChange` do checkbox, gravar a preferência em `localStorage` (`"true"`/`"false"`).
- Antes de chamar `supabase.auth.signInWithPassword`, garantir que a preferência atual esteja persistida (já feita no onChange; regravar por segurança).
- Sem alteração no fluxo de redirect/`resolveNext`.

## Não incluído
- Nenhuma mudança em roteamento, RBAC, gating ou outras telas.
- Nenhuma alteração em `previewAuthStorage.ts` (arquivo gerado).

## Validação
- Build/typecheck sem erros.
- Preview: login com "Lembrar-me" marcado → fechar/reatribuir aba mantém sessão; desmarcado → fechar aba desloga (sessionStorage).

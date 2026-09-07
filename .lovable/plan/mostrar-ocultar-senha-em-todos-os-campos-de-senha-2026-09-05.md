# Mostrar/ocultar senha em todos os campos de senha

Hoje só o login e a tela de redefinir senha têm o "olhinho" para ver o que foi digitado. Todos os outros campos de senha do sistema (primeiro acesso, criação do Super Admin, conta do cliente, chaves e senhas de integrações) mostram apenas pontinhos.

## O que muda

Um único campo de senha padrão, com botão de olho para mostrar/ocultar, usado em todo o sistema — master e instalações derivadas.

Comportamento:
- Botão de olho no canto direito do campo, começando oculto.
- Alterna entre texto visível e oculto ao clicar; volta a ocultar ao sair da tela.
- Acessível: rótulo "Mostrar senha"/"Ocultar senha", foco por teclado, não envia o formulário ao clicar.
- Nada muda na validação, no salvamento ou nas regras de segurança.

## Onde passa a aparecer

- Primeiro acesso obrigatório (nova senha e confirmação)
- Criação do Super Admin na primeira configuração
- Minha conta do portal do cliente
- Perfil do usuário (troca de senha)
- Redefinir senha (padroniza o que já existe)
- Login (padroniza o que já existe)
- Campos de chave/senha das integrações: IA, Evolution/WhatsApp, central de mensagens, Meta e conexões

## Detalhes técnicos

- Novo componente `src/components/ui/password-input.tsx`: encapsula `Input` com `type` alternável, botão `Eye`/`EyeOff` (lucide) posicionado com `absolute`, `pr-10` no input, repasse de `ref` e de todas as props (`autoComplete`, `minLength`, `required`, `...field` do react-hook-form).
- Substituir `type="password"` pelos 11 usos atuais em: `mandatory-password-reset.tsx`, `setup.tsx`, `portal-account.tsx`, `settings.profile.tsx`, `connections/ai-center.tsx`, `connections/evolution-config-card.tsx`, `messaging/messaging-center.tsx`, `routes/_authenticated/admin.meta.tsx`, `routes/_authenticated/connections.tsx`.
- Remover o `PasswordInput` local de `login-form.tsx` e o `showPassword` manual de `reset-password.tsx`, apontando ambos para o componente compartilhado.
- Somente apresentação: nenhuma mudança em server functions, RLS ou migrations.

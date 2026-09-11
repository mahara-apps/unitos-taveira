# Campo de e-mail com etiquetas (padrão único)

Hoje só o "Adicionar membro" tem o campo de e-mails em etiquetas, com o código escrito direto na tela. A ideia é transformar esse comportamento em um componente reutilizável e usá-lo em todos os lugares onde é possível informar mais de um e-mail.

## O que muda

1. Criar um campo de e-mails reutilizável, com o mesmo visual do print: etiqueta por e-mail, "x" para remover, Enter/vírgula/espaço para adicionar, colar uma lista de e-mails cria várias etiquetas de uma vez, Backspace no campo vazio remove a última.
2. E-mail inválido é bloqueado: a etiqueta não é criada e aparece um aviso curto abaixo do campo. Duplicados são ignorados silenciosamente.
3. Usar esse campo em:
   - Adicionar membro > Convidar por e-mail (substitui o código atual, mesmo comportamento).
   - Adicionar usuário > aba de convite, que hoje aceita só um e-mail e passa a aceitar vários no mesmo envio.
4. Campos que representam um único e-mail continuam simples, como decidido: login, recuperação de senha, primeiro acesso (/setup), perfil, e-mail de acesso do portal, contato do cliente (cadastro/edição) e criação de acesso do cliente.

## Detalhes técnicos

- Novo componente `src/components/ui/email-tags-input.tsx`: props `value: string[]`, `onChange`, `placeholder`, `id`, `hint`, `disabled`, `max?`. Validação por Zod (`z.string().trim().toLowerCase().email().max(255)`), normalizando para minúsculas; erro exibido inline, sem toast.
- `src/components/settings/add-member-drawer.tsx`: remove o bloco inline de badges/draft e passa a renderizar o novo componente, mantendo `inviteBrandMembers`, papéis e a lógica de autoridade intactos.
- `src/components/settings/add-user-dialog.tsx`: estado do convite passa de `email: string` para `emails: string[]`; a chamada de convite já envia `emails: []`, então só o preenchimento muda. A aba de criação direta de acesso (que gera senha provisória) continua com um único e-mail.
- Sem mudanças de rota, backend, RLS, RBAC ou schema. Validação de servidor em `src/lib/team.functions.ts` permanece como está.
- Validar com `bunx tsgo --noEmit`, build e `bun run master:check`; por ser alteração só de código, regerar o pacote e sincronizar `delta_version.txt` + `MASTER_RELEASE_VERSION` na próxima versão (1.3.50), sem mudança de SHA de SQL.

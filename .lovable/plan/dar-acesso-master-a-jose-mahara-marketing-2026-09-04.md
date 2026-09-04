# Dar acesso master a jose@mahara.marketing

Objetivo: esse e-mail passa a ter autoridade total dentro do sistema — enxerga
tudo, administra o workspace do MASTER e pode provisionar, validar e autorizar
atualizações/publicações das instalações no painel de Instalações.

## O que será feito

1. Localizar a conta pelo e-mail `jose@mahara.marketing`.
   - Se a conta ainda não existir, o acesso não pode ser concedido: nesse caso
     o passo é criar o acesso pela tela de Usuários (ou ele mesmo se cadastrar)
     e só depois promover. Isso será confirmado antes de qualquer alteração.
2. Marcar o perfil dele como master (super admin), que é o nível acima de
   qualquer workspace e é o que libera o painel de Instalações por completo.
3. Garantir que ele seja **Owner** do workspace do MASTER, para que o sistema
   abra normalmente com dados, clientes e configurações — sem depender só do
   nível master.
4. Conferir, depois da alteração, que:
   - o perfil dele responde como master;
   - o menu de Instalações e as ações de provisionar/validar/atualizar ficam
     liberadas;
   - nenhum outro usuário foi afetado.

## Observações importantes

- Publicar o projeto aqui na Lovable é outra coisa (convite de colaborador nas
  configurações do projeto) e continua fora deste ajuste, conforme combinado.
- Alteração é só de dados de acesso: nenhuma regra de segurança, política ou
  código de permissão será afrouxada.

## Detalhes técnicos

- `jose@mahara.marketing` já está na allowlist de e-mails de
  `public.is_super_admin()` (migration `20260715021902`), mas as verificações
  do app usam `resolveIsSuperAdmin` → `is_super_admin(_user_id)`, que lê
  `public.user_profiles.is_super_admin` / `role`. Sem esse registro, o acesso
  master não fica ativo de forma confiável.
- Ação de dados (não migration), via `supabase--run_sql`:
  - `select id from auth.users where lower(email) = 'jose@mahara.marketing'`;
  - `update public.user_profiles set is_super_admin = true, role = 'super_admin'
    where id = <uuid>`;
  - `insert ... on conflict` em `public.brand_members` com `role = 'owner'` para
    o workspace do MASTER (`public.brands`), mantendo idempotência.
- O trigger `guard_super_admin_flag` só bloqueia quando `auth.uid()` não é
  master; a execução administrativa (service role, `auth.uid()` nulo) é
  permitida por desenho.
- Verificação final com `select public.is_super_admin(<uuid>)` e leitura de
  `brand_members`.
- A conexão do Supabase apareceu expirada na última consulta; se persistir,
  será necessário reconectar a conta Supabase antes de aplicar.

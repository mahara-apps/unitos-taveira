# Usuários operacionais com níveis de permissão por módulo

Hoje o acesso é decidido só pelo papel (Super Admin / Owner / Admin / Manager / User). Quem é "User" tem sempre o mesmo pacote de operação. A ideia é criar uma camada de permissões por módulo para a equipe do dia a dia, sem mexer na hierarquia de administradores.

## Como vai funcionar

1. **Perfis de acesso** (por workspace), prontos e editáveis: Atendimento, Criativo, Tráfego, Mídia, Produção, Financeiro, Total. Você pode criar novos perfis e renomear.
2. **Ajuste por módulo no usuário**: ao abrir um usuário, o perfil vem aplicado e cada módulo pode ser alterado individualmente. Quando houver ajuste, o perfil aparece como "Atendimento (personalizado)", como no seu outro sistema.
3. **Níveis por módulo**: Nenhum · Ver · Ver + Próprios registros · Total.
   - Nenhum: o módulo nem aparece no menu.
   - Ver: só leitura.
   - Ver + Próprios: lê tudo do escopo dele e cria/edita/remove apenas o que ele criou ou onde está envolvido.
   - Total: cria, edita e remove qualquer registro do escopo dele.
4. **Escopo por cliente continua valendo**: mesmo com "Total" em Projetos, o usuário só vê os clientes atribuídos a ele. Permissão diz *o que* pode fazer; escopo diz *onde*.
5. **Dois caminhos para adicionar usuário** (ambos na mesma tela, em abas):
   - Convidar por e-mail: a pessoa recebe o convite e cria a própria senha.
   - Criar acesso agora: você define o e-mail, o sistema gera a senha e envia por e-mail.
   Em ambos você escolhe o perfil de acesso e, opcionalmente, já vincula os clientes.
6. Administradores (Super Admin, Owner, Admin) seguem exatamente como estão: acesso total, sem tabela de módulos. Manager continua administrando os clientes atribuídos.

## Módulos cobertos

Clientes · Briefing · Projetos · Tarefas · Planejamento/Pautas · Conteúdo & Posts · Calendário · Aprovações · Planos de mídia · Conexões e canais · Relatórios · Usuários e permissões · Configurações do workspace · IA e agentes · Brain · Chat · Portal do cliente.

## Tela de usuários e permissões

- Lista com nome, e-mail, perfil de acesso, clientes atribuídos, status e último acesso.
- Botão "Adicionar usuário" abre o diálogo com as duas abas (convite / criar acesso).
- Ao abrir um usuário: cabeçalho com dados e chave "Acesso ao sistema: Sim/Não", seletor de perfil e a lista de módulos com um seletor de nível e a descrição do que aquele nível permite, agrupada por área.
- Botão "Voltar ao perfil" desfaz a personalização.
- Aba de "Perfis de acesso" para editar os perfis padrão do workspace.

## Detalhes técnicos

**Banco (migração)**
- `public.access_profiles`: `brand_id`, `key`, `name`, `is_system`, `permissions jsonb`, timestamps. GRANTs para `authenticated`/`service_role`, RLS: leitura por membros do workspace; escrita apenas Super Admin/Owner/Admin.
- `public.brand_members`: novas colunas `access_profile_id uuid null` e `module_permissions jsonb null` (overrides do usuário).
- Seed dos perfis de sistema por workspace (trigger no `brands` + backfill), no mesmo formato usado pelo pacote de instalação.
- Funções `security definer`: `public.effective_module_permissions(_user_id, _brand_id)` (perfil + overrides, admins retornam tudo `full`) e `public.has_module_access(_user_id, _brand_id, _module, _min_level)`.
- RLS das tabelas operacionais (`projects`, `tasks`, `posts`, `monthly_plans`, `media_plans`, `clients`, comentários) passa a compor o escopo atual com `has_module_access`, mantendo o gate de escopo por cliente já existente. `own` usa as colunas de autoria/atribuição já presentes.
- A coluna legada `permissions` (rótulos sem enforcement) deixa de ser gravada; leitura só para migração.

**Código**
- `src/lib/module-permissions.ts`: catálogo de módulos, níveis, presets dos perfis, merge perfil+override, rótulos pt-BR, helper `can(module, action)`. Fonte única compartilhada por UI e servidor.
- `src/lib/access-guard.ts`: `assertModuleAccess(supabase, userId, brandId, module, level)` para as server functions de escrita.
- `src/lib/permissions.ts`: sidebar passa a ser derivada dos módulos com nível ≥ Ver, em vez do mapa fixo por papel.
- `src/lib/team.functions.ts`: `inviteBrandMembers`, `provisionUser` e `updateBrandMember` aceitam `accessProfileId` + `modulePermissions`; validação Zod dos níveis; só Owner/Admin/Super Admin podem alterar permissões.
- Novas server functions em `src/lib/access-profiles.functions.ts` para listar/criar/editar perfis.
- UI: `settings.permissions.tsx` vira a tela de gestão (lista + perfis), nova rota de edição do usuário, e `add-user-dialog.tsx` com as duas abas.
- Testes unitários do merge perfil/override, dos presets e do gating de sidebar; testes das server functions de permissão.

**Ordem de execução**: migração → catálogo e helpers → server functions → RLS composta → UI → testes. A instalação Taveira recebe isso na próxima versão publicada pelo painel de Instalações.

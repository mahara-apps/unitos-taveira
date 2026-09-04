# Propagar as correções para a Taveira e para toda instalação nova

Hoje as correções de banco feitas no MASTER (incluindo os perfis de acesso/permissões por módulo e a correção do papel do membro de hoje) **não chegam automaticamente** às instalações já criadas:

- O pacote de instalação nova só contém alterações até 04/09 13h (arquivo de deltas gerado antes das últimas três alterações). Uma instalação criada agora nasceria sem os perfis de acesso e com o mesmo erro que travou a tela de permissões.
- A operação "Atualizar" de uma instalação existente hoje só republica o código (novo deploy + registro de versão). Nenhuma etapa toca no banco da instalação, então a Taveira continua com o banco antigo — foi por isso que ela já apresentou falta de tabelas antes.

## O que será feito

1. **Atualizar o pacote de instalação** com todas as alterações de banco feitas depois de 04/09 13h (perfis de acesso, permissões por módulo, convites com perfil e a correção de hoje). Assim, toda instalação nova já nasce correta.

2. **Incluir uma etapa de banco na operação "Atualizar"** do painel de Instalações, com barra de progresso própria, igual às etapas do provisionamento:
   - aplica somente o que ainda falta no banco da instalação, item por item, e pode ser reexecutada sem risco (nada é aplicado duas vezes);
   - registra no próprio banco da instalação o que já foi aplicado, para retomar de onde parou se a execução for interrompida;
   - falha visível com o motivo exato, em vez de deploy "verde" com banco desatualizado.

3. **Rodar essa atualização na Taveira** e conferir:
   - a tela de Configurações → Permissões abre (usuários, perfis de acesso e papéis);
   - a lista de módulos/permissões carrega sem tela branca;
   - o relatório de saúde da instalação não aponta itens faltantes.

4. **Documentar** no checklist de instalação que, a cada correção de banco no MASTER, a sequência é: atualizar o pacote → rodar "Atualizar" em cada instalação (a etapa de banco passa a fazer parte disso).

## Detalhes técnicos

- Regenerar `supabase/baseline-snapshot/007_delta_migrations.sql` com `tools/build_delta.py` (manifesto hoje termina em `20260904142244`; faltam `20260904204006`, `20260904204218` e `20260904205402`). Ajustar os limites de contagem em `supabase/install/verify-installation.sql` se necessário.
- Em `manager-contract.ts`: adicionar `{ id: "database", label: "Atualização do banco" }` a `UPDATE_STEPS` (antes de `version`).
- Em `automation.server.ts`: extrair a aplicação do delta para uma rotina reutilizável e chamá-la na operação `update`, reaproveitando `applyStatementByStatement`, `sanitizeBaselineSqlForManagementApi`, os checkpoints por statement e a fila `_unitos_deferred_sql` já usados no provisionamento.
- Ledger no banco de destino: `public._unitos_applied_deltas(label text primary key, applied_at timestamptz default now())`, gravada por arquivo de delta aplicado, para que "Atualizar" repetido seja no-op rápido.
- Em `manager.functions.ts` (`kind === "update"`) e em `resume-worker.server.ts`: incluir a nova etapa no fluxo e na retomada.
- Nada muda no MASTER em termos de dados; RBAC/RLS e credenciais por instalação permanecem como estão (a execução usa o token de management já guardado em `installation_credentials`).

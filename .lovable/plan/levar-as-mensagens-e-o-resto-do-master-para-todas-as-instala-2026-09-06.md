# Levar as Mensagens (e o resto) do MASTER para todas as instalações

## Situação verificada

- O pacote de instalação (`007_delta_migrations.sql` + manifesto) termina na alteração de 06/09 22:01. As **três alterações das Mensagens** (conversas, participantes, mensagens, permissões, contadores de não lidas, tempo real) ficaram de fora. Uma instalação nova hoje nasceria sem o módulo.
- A operação "Atualizar" já aplica o pacote de banco na instalação, com registro do que foi aplicado e retomada — então basta o pacote estar atualizado para a Taveira e as demais receberem.
- A versão anunciada pelo MASTER está em `1.0.9`, anterior às Mensagens: as instalações não veem que há atualização disponível.
- Um detalhe bloqueante: a alteração das Mensagens acrescenta um novo tipo de aviso (`notification_kind = 'message'`) com um comando que o Postgres **não aceita executar dentro do bloco protegido** usado pela aplicação automática. Sem tratar isso, a etapa de banco falha na primeira instalação.
- Os comandos de tempo real ("adicionar tabela à publicação") já são tolerados quando repetidos, então repetir a atualização continua seguro.

## O que será feito

1. **Regenerar o pacote de instalação** com as três alterações das Mensagens incluídas, mantendo a ordem cronológica.
2. **Tratar o novo tipo de aviso**: aplicar esse comando fora do bloco protegido, de forma que já exista antes do resto e possa ser repetido sem erro.
3. **Publicar a nova versão** do MASTER (`1.1.0`), para que cada instalação mostre "atualização disponível" e o histórico registre de/para.
4. **Ajustar a validação da instalação** para contar as novas tabelas/regras de acesso e conferir que o tempo real das mensagens está ativo — assim o relatório de saúde acusa instalação incompleta em vez de passar "verde" sem o módulo.
5. **Rodar a atualização na primeira instalação real** (Taveira) e conferir: aba Mensagens abre para a equipe, aba Mensagens do portal abre para o cliente, contadores de não lidas funcionam e o relatório de saúde fica PASS.
6. **Registrar no checklist** a sequência definitiva: alteração no MASTER → regenerar pacote → subir versão → "Atualizar" em cada instalação.

## Detalhes técnicos

- `python3 supabase/baseline-snapshot/tools/build_delta.py` para regenerar `007_delta_migrations.sql` e `tools/delta_manifest.txt` (faltam `20260906221742`, `20260906221905`, `20260906222307`). O teste `tests/installation-baseline-completeness.unit.test.ts` volta a passar sem alteração.
- `automation.server.ts`: em `sanitizeBaselineSqlForManagementApi`/`applyStatementByStatement`, extrair `ALTER TYPE ... ADD VALUE` dos statements protegidos e executá-los isolados (autocommit, `IF NOT EXISTS` já presente) antes do lote; `ALTER PUBLICATION ... ADD TABLE` continua coberto por SQLSTATE 42710.
- `manager-contract.ts`: `MASTER_RELEASE_VERSION = "1.1.0"`. O ledger `_unitos_applied_deltas` é por impressão digital do conteúdo, logo o novo delta é aplicado mesmo em instalação já atualizada.
- `supabase/install/verify-installation.sql`: elevar os limites de tabelas/policies e adicionar checagens de `message_threads`, `message_thread_participants`, `messages`, `can_access_message_thread`, `message_unread_counts` e presença das tabelas na publicação `supabase_realtime`.
- Nenhuma mudança de RBAC/RLS além do que já está nas migrations; o módulo `chat` (`/chat`, `/messages`) e o módulo `messages` do portal já vêm por código no deploy.

## Fora de escopo

Não altera o banco do MASTER, credenciais, OAuth/Meta, nem o fluxo de deploy do próprio MASTER.

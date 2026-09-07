# Regra permanente: toda alteração nasce no MASTER e propaga

## Situação verificada

- Existe um pacote de instalação (`007_delta_migrations.sql` + `tools/delta_manifest.txt`) e uma verificação automática (`tests/installation-baseline-completeness.unit.test.ts`) que já reprova quando uma alteração de banco fica fora do pacote.
- Essa verificação cobre só o banco. Hoje **nada** reprova quando:
  - a versão anunciada pelo MASTER (`MASTER_RELEASE_VERSION`, hoje `1.2.0`) não sobe depois de uma alteração — as instalações não veem "atualização disponível";
  - uma tabela/função nova não entra no relatório de saúde (`supabase/install/verify-installation.sql`), então a instalação passa "verde" sem o módulo;
  - a última alteração ainda não foi regenerada no pacote (o pacote está atualizado até 06/09 23:15).
- A regra também não está escrita em nenhum lugar que o sistema leia sozinho (`AGENTS.md`, checklist de instalação).

## O que será feito

1. **Escrever a regra como lei do projeto.** Uma seção curta e obrigatória em `AGENTS.md` e no checklist de instalação: nenhuma alteração é considerada concluída antes de estar no pacote do MASTER, com versão nova e verificação de saúde cobrindo o que foi criado.

2. **Guardião automático.** Ampliar a verificação existente para reprovar automaticamente quando:
   - houver alteração de banco fora do pacote (já existe, será mantido);
   - o pacote tiver mudado sem a versão do MASTER subir;
   - houver tabela nova no pacote que o relatório de saúde não confere.
   Assim, esquecer a propagação passa a quebrar a checagem do projeto, não a instalação do cliente.

3. **Fechar a pendência atual.** Regenerar o pacote com tudo até hoje, subir a versão anunciada e completar o relatório de saúde, deixando o guardião verde.

4. **Memória do projeto.** Registrar a regra como regra central, para que ela seja aplicada em qualquer tarefa futura sem precisar ser repetida.

5. **Um lugar único para ver o estado.** Um comando/checagem que responde em uma linha: pacote em dia? versão em dia? saúde cobrindo tudo? — usado antes de publicar.

## Detalhes técnicos

- `tests/installation-master-sync.unit.test.ts` (novo, ao lado do teste de completude):
  - assert de que cada `CREATE TABLE public.<x>` presente no delta aparece em `verify-installation.sql`, com lista explícita de exceções auditadas (helpers `_unitos_*`, tabelas MASTER-only `installations`, `installation_operations`, `installation_credentials`);
  - assert de coerência de versão: arquivo `supabase/baseline-snapshot/tools/delta_version.txt` (novo) guarda a versão associada ao conteúdo do delta; o teste exige que `MASTER_RELEASE_VERSION` (`src/lib/installation/manager-contract.ts`) seja igual a esse valor e que ambos mudem juntos (impressão digital do delta gravada no mesmo arquivo);
  - reaproveita `import.meta.glob` das migrations, como o teste atual.
- Regenerar pacote: `python3 supabase/baseline-snapshot/tools/build_delta.py` (manifesto termina em `20260906231507`; conferir migrations posteriores), atualizar `delta_version.txt` e elevar `MASTER_RELEASE_VERSION` para `1.2.1`.
- `supabase/install/verify-installation.sql`: acrescentar as checagens que faltarem para as tabelas/colunas do delta e ajustar os limites de contagem (tabelas/policies/triggers/funções).
- `docs/CHECKLIST_NOVA_INSTALACAO.md` + `AGENTS.md`: seção "MASTER-first" com a sequência fixa — alteração no MASTER → regenerar pacote → subir versão → cobrir no relatório de saúde → "Atualizar" em cada instalação.
- Memória: regra Core "Toda alteração (schema, seed, versão) é MASTER-first: regenerar delta, subir MASTER_RELEASE_VERSION e cobrir no verify antes de concluir".
- Sem mudança de RBAC/RLS, credenciais, OAuth/Meta ou schema do app.

## Fora de escopo

Não aplica a atualização nas instalações (isso continua sendo a operação "Atualizar" do painel, disparada por você) e não altera o banco do MASTER além do necessário para a regeneração do pacote.

# Corrigir a atualização travada da Casa 8

## Diagnóstico confirmado

- A operação da Casa 8 foi encerrada como sucesso em **1.3.51**, mas não recebeu um identificador de publicação da hospedagem.
- O código caiu no plano alternativo por Git e marcou imediatamente as etapas “Build” e “Versão” como concluídas.
- Nesse caminho, o sistema não confirmou que a hospedagem detectou o novo commit, iniciou o build e colocou a nova publicação em produção.
- Por isso o painel avançou `current_version`/`pinned_release` para 1.3.51 mesmo sem comprovação de que o ambiente estava servindo essa versão.

## Correção

1. **Não concluir no disparo por Git**
   - Depois do push, localizar a publicação de produção correspondente ao commit recém-enviado.
   - Manter a operação em andamento enquanto a hospedagem ainda não criou ou concluiu esse build.
   - O cron continuará a mesma operação usando checkpoints, sem criar commits ou publicações duplicadas.

2. **Confirmar a versão antes de gravá-la**
   - Só marcar “Build”, “Versão” e a operação como concluídos após a hospedagem responder `READY` para o commit esperado.
   - Se o build falhar, for cancelado ou exceder o limite, encerrar com erro claro e manter a versão anterior no painel.
   - A validação do banco continuará separada e não poderá comprovar a versão do frontend.

3. **Recuperar a Casa 8**
   - Corrigir o registro incorreto que hoje afirma 1.3.51 sem publicação confirmada.
   - Reabrir uma atualização segura para o mesmo commit e acompanhar até a publicação real.
   - Ao final, conferir o domínio da Casa 8 e só então registrar a versão aplicada.

4. **Evitar regressão**
   - Testar push sem publicação criada, build em andamento, `READY`, falha/cancelamento e timeout.
   - Garantir que nenhum caminho alternativo avance a versão sem confirmação da hospedagem.

## Fechamento MASTER-first

- Regenerar o pacote do MASTER.
- Sincronizar `delta_version.txt` e `MASTER_RELEASE_VERSION` em uma nova versão.
- Rodar testes direcionados, verificação de tipos, build e `bun run master:check`.
- Publicar o MASTER corrigido e repetir a atualização da Casa 8.

## Fora de escopo

- Nenhuma alteração em RBAC, RLS, usuários, conteúdo ou dados operacionais dos demais ambientes.

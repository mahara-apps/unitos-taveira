# Corrigir exclusão de clientes e reforçar as confirmações

## Diagnóstico confirmado

- A exclusão do cliente aciona `ON DELETE CASCADE` sobre seus pipelines.
- O gatilho `protect_default_pipeline` bloqueia a remoção do último pipeline com `cannot_delete_last_pipeline`, sem distinguir uma exclusão isolada de pipeline da exclusão do próprio cliente.
- Por isso, a cascata chega ao último pipeline e aborta toda a exclusão. A regra está no pacote compartilhado do MASTER, então pode afetar qualquer instalação e qualquer cliente que tenha pipeline — não apenas a Taveira.
- O cliente mostrado, **Use do avesso**, possui 2 pipelines ativos e a mensagem exibida corresponde exatamente a esse gatilho.
- A autorização já é validada no servidor e no banco; somente Admin/Owner do workspace ou Super Admin podem excluir clientes. Isso será preservado.

## Implementação

1. **Corrigir a regra no banco do MASTER**
   - Criar uma migration que ajuste `protect_pipeline_delete()` para manter a proteção ao excluir manualmente o último pipeline de um cliente existente.
   - Permitir a remoção dos pipelines quando o próprio cliente já estiver sendo excluído pela cascata.
   - Não afrouxar RLS, escopo por workspace ou permissões de exclusão.

2. **Tornar as três confirmações inequívocas**
   - Confirmação 1: clicar em **Excluir** no menu do cliente.
   - Confirmação 2: digitar exatamente o nome do cliente na janela de impacto.
   - Confirmação 3: clicar em **Continuar** e receber um último aviso separado; somente o botão destrutivo desse aviso executará a exclusão.
   - Manter o nome e o identificador do cliente fixos durante todo o fluxo, bloquear duplo envio e limpar o estado ao cancelar ou concluir.
   - Revalidar no servidor o nome digitado; o último clique será um passo de interface, sem substituir as barreiras de autoridade do servidor e do banco.

3. **Mensagens de erro compreensíveis**
   - Não exibir códigos internos como `cannot_delete_last_pipeline` ao usuário.
   - Traduzir falhas esperadas de exclusão para uma mensagem clara, preservando o detalhe técnico apenas para diagnóstico seguro.

4. **Cobertura completa da exclusão em cascata**
   - Testar cliente sem pipeline, com um pipeline e com múltiplos pipelines.
   - Confirmar que apagar diretamente o último pipeline continua bloqueado.
   - Confirmar que Manager/User e usuários de outro workspace continuam sem poder excluir clientes.
   - Confirmar que nome incorreto e ausência do último aviso não executam a exclusão.
   - Revisar os demais relacionamentos em cascata e gatilhos ligados a `clients` para detectar outro bloqueio equivalente antes de concluir.

5. **Propagação MASTER-first**
   - Aplicar a migration no MASTER e incluir a função corrigida na verificação de instalação.
   - Regenerar o delta, atualizar `delta_version.txt` e `MASTER_RELEASE_VERSION` com a mesma nova versão.
   - Executar testes direcionados, typecheck, build e `bun run master:check`.
   - Publicar o MASTER e então atualizar/validar a Taveira, confirmando a exclusão real de um cliente de teste sem tocar no cliente **Use do avesso** durante a validação.

## Resultado esperado

A exclusão completa de clientes funcionará em todas as instalações mesmo quando houver pipelines, enquanto a exclusão isolada do último pipeline continuará protegida. O usuário passará por três etapas explícitas antes da ação irreversível.

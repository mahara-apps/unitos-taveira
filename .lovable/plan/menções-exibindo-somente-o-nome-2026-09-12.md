# Menções exibindo somente o nome

## Objetivo
Garantir que, ao selecionar uma pessoa com `@`, comentários, conversas, prévias e notificações mostrem apenas `@Nome do usuário`, sem colchetes, parênteses, UUIDs ou outros caracteres técnicos.

## Diagnóstico confirmado
O seletor atual insere no campo o marcador `@[Nome](uuid)`. Esse conteúdo completo é enviado e salvo como corpo da mensagem/comentário. A tela principal consegue mascará-lo depois do envio, mas o campo de digitação, prévias e notificações podem expor o marcador bruto.

## Implementação

1. **Separar texto visível e identificação da pessoa**
   - Alterar o campo compartilhado de menções para inserir somente `@Nome` no texto.
   - Manter internamente a associação entre o trecho selecionado e o ID do usuário, sem colocar o ID no conteúdo.
   - Remover a associação automaticamente quando a menção for apagada ou alterada.
   - Preservar a escolha correta em casos de nomes iguais enquanto a mensagem está sendo composta.

2. **Aplicar o novo contrato em todos os pontos**
   - Ajustar comentários de tarefas, projetos e jobs.
   - Ajustar o compositor de conversas.
   - Enviar o corpo limpo e a lista separada de IDs mencionados para as funções já protegidas no servidor.
   - Manter a validação server-side que exclui IDs inválidos, usuários fora do workspace e o Super Admin global.

3. **Compatibilidade e saneamento**
   - Criar um utilitário único para converter marcadores antigos em `@Nome`.
   - Usá-lo defensivamente na leitura/renderização, nas prévias de conversas e nos textos de notificações.
   - Adicionar migration idempotente no MASTER para limpar marcadores técnicos já armazenados em mensagens, comentários de tarefas, comentários de projeto/job e prévias de conversa, preservando as colunas separadas de IDs mencionados.

4. **Testes**
   - Cobrir seleção, envio e renderização mostrando somente o nome.
   - Cobrir exclusão/edição da menção, nomes iguais, texto legado e múltiplas menções.
   - Verificar que notificações continuam chegando apenas aos destinatários válidos e sem UUID no texto.
   - Adicionar um guardião para impedir que novos fluxos persistam marcadores técnicos no corpo.

5. **MASTER-first e validação**
   - Incluir a migration no MASTER e regenerar o pacote delta.
   - Atualizar a versão e o SHA do pacote em sincronia.
   - Atualizar a verificação de instalação se a estrutura de validação exigir cobertura adicional.
   - Executar testes direcionados, typecheck, build, `git diff --check` e `bun run master:check`.

## Resultado esperado
Ao escolher uma pessoa, o usuário verá, editará, enviará e reencontrará apenas `@Nome do usuário`. A identificação necessária para notificações continuará segura e separada do texto visível.

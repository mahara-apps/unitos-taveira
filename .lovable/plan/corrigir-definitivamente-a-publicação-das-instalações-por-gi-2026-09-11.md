# Corrigir definitivamente a publicação das instalações por Git

## Diagnóstico confirmado

- Casa 8 e Taveira falharam pelo mesmo motivo: o código chegou ao repositório, mas a etapa seguinte ainda tentou criar um deployment pela API da hospedagem.
- O fallback atual cria outro commit e procura um deployment pelo SHA, porém ainda pode selecionar/acompanhar uma tentativa recusada como REST; por isso a própria tentativa chamada de “disparada pelo Git” termina com a mensagem de bloqueio de REST.
- Estado atual: Casa 8 permanece em `1.3.53`; Taveira está registrada em `1.3.56`; ambas estão sem operação ativa e com a última operação finalizada como falha.

## Implementação

1. Tornar a atualização **Git-first**:
   - publicar o snapshot autorizado no repositório da instalação;
   - garantir o vínculo correto entre projeto e repositório e o build automático ativo;
   - acompanhar exclusivamente o deployment criado pelo commit enviado ao Git;
   - não chamar `POST /v13/deployments` no fluxo normal de atualização.

2. Fortalecer a identificação do deployment:
   - exigir correspondência do SHA e origem Git;
   - ignorar deployments REST/API, inclusive quando compartilham metadados ou commit;
   - priorizar `READY`, depois estados em andamento, e somente considerar falha de um deployment Git legítimo;
   - manter retomada idempotente pelos checkpoints, sem criar commits ou builds duplicados.

3. Ajustar mensagens e etapas do painel:
   - remover a indicação de que a atualização cria deployment via REST;
   - exibir “aguardando build do commit no Git” enquanto a hospedagem ainda não o detectou;
   - mostrar falha somente quando o deployment Git correspondente realmente terminar em erro;
   - limpar corretamente erro e manutenção após sucesso, preservando suspensão administrativa.

4. Criar regressões automatizadas para:
   - política que aceita somente Git;
   - coexistência de deployment REST bloqueado e deployment Git pronto/em andamento;
   - ausência temporária do webhook/build;
   - retomada sem duplicação;
   - Casa 8 e Taveira seguindo o mesmo fluxo geral.

5. Aplicar o processo MASTER-first:
   - atualizar o MASTER e seus testes;
   - regenerar o pacote delta;
   - avançar e sincronizar `delta_version.txt` e `MASTER_RELEASE_VERSION`;
   - atualizar a verificação da instalação quando aplicável;
   - executar typecheck, testes, build e `master:check`.

6. Publicar e recuperar os dois ambientes:
   - publicar o MASTER;
   - atualizar primeiro um ambiente e confirmar deployment Git `READY`, validação final e versão registrada;
   - repetir no segundo ambiente;
   - confirmar Casa 8 e Taveira sem operação ativa, sem erro/manutenção residual e na versão nova.

## Limites de segurança

- Não alterar credenciais, RBAC, RLS ou dados operacionais dos clientes.
- Não marcar versão como concluída antes de comprovar o deployment Git `READY` e a validação final.
- Não reconciliar versões manualmente sem evidência do código efetivamente publicado.

# Corrigir aviso de atualização preso na Taveira

## Diagnóstico confirmado

A Taveira já está atualizada e saudável no MASTER: versão publicada `1.3.55`, status `up_to_date`, nenhuma operação ativa e validação com 40 verificações aprovadas.

O aviso continua porque o estado de manutenção fica no banco da própria instalação. O fluxo iniciado pela tela ativa esse estado e sabe removê-lo, mas quando uma atualização pendente é retomada e concluída pelo cron do MASTER, `resume-worker.server.ts` chama a atualização diretamente e não executa a limpeza. Assim, a operação termina no painel, porém a faixa permanece até o prazo de segurança expirar.

## Correção

1. **Liberar a Taveira agora**
   - Confirmar novamente que não existe operação ativa.
   - Alterar somente o estado operacional remoto da Taveira de `maintenance` para `active`, limpando mensagem e validade.
   - Não alterar versão, dados operacionais, usuários ou credenciais.

2. **Centralizar o controle do aviso**
   - Extrair a escrita remota de `maintenance`/`active` para uma função compartilhada do Installation Manager.
   - Reutilizar essa função tanto no início manual quanto nas retomadas pelo cron, evitando caminhos com comportamentos diferentes.

3. **Encerrar corretamente em todos os resultados**
   - Manter `maintenance` apenas quando o resultado for realmente `PENDING`.
   - Voltar para `active` após `PASS`, `FAIL` ou `BLOCKED` e também após exceção finalizada.
   - Preservar o prazo automático de segurança como proteção adicional, não como mecanismo normal de encerramento.
   - Não remover um estado `suspended` definido administrativamente.

4. **Cobrir regressões**
   - Testar atualização concluída diretamente e atualização concluída após retomada pelo cron.
   - Testar falha terminal, exceção e resultado pendente.
   - Garantir que somente `PENDING` mantém o aviso e que suspensão administrativa não é sobrescrita.

5. **Fechamento MASTER-first**
   - Regenerar o pacote de atualização.
   - Sincronizar `delta_version.txt` e `MASTER_RELEASE_VERSION` na próxima versão.
   - Executar testes direcionados, verificação de tipos, build e `bun run master:check`.
   - Publicar o MASTER e autorizar a atualização das instalações.

## Resultado esperado

Ao terminar uma atualização — pela tela ou pelo cron — a faixa “Atualização em andamento” desaparece automaticamente. Se a execução continuar pendente, o aviso permanece; se houver suspensão administrativa, ela continua respeitada.

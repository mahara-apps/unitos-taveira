# Corrigir versão da Taveira e liberar atualização pelo MASTER

## Diagnóstico confirmado

- A Taveira continua realmente no código **1.2.9**, commit **4b11ace** (`pinned_release`/`pinned_commit_sha`).
- Às **19:53 de 07/09/2026**, a validação automática passou nas 30 verificações, mas gravou indevidamente `current_version = 1.3.6` e `status = up_to_date`. A validação de saúde está usando a versão do processo MASTER como se fosse a versão instalada; por isso a lista volta a mostrar dados contraditórios após cada validação.
- A tentativa de atualização imediatamente anterior foi bloqueada corretamente: o repositório publicado do MASTER ainda continha o pacote **1.2.9**, enquanto o sistema já declarava **1.3.6**.
- O secret **`UNITOS_GITHUB_TOKEN` não está configurado**. Sem ele, o MASTER não consegue ler o repositório privado, confirmar a versão disponível nem autorizar uma atualização segura.

## Correção

1. **Separar saúde de versão**
   - A validação continuará verificando banco, RLS, storage, cron, frontend e primeiro acesso.
   - Ela não poderá mais alterar `current_version`, `pinned_release` nem fingir que uma instalação recebeu código novo.
   - Ao concluir uma validação, o status de atualização será calculado pela versão realmente publicada (`pinned_release`, com fallback legado), mantendo a saúde como informação independente.

2. **Unificar a fonte da versão em todo o Installation Manager**
   - Lista, detalhe, filtros, ação principal e mensagens usarão a release fixada como versão instalada.
   - `current_version` ficará compatível com registros legados, mas não prevalecerá sobre `pinned_release`.
   - A ação principal mostrará “Autorizar atualização” quando a release fixada estiver atrás, sem depender apenas da comparação de commits antes da consulta ao MASTER terminar.

3. **Configurar o acesso ao GitHub do MASTER**
   - Abrir o formulário seguro para adicionar `UNITOS_GITHUB_TOKEN`.
   - O token deverá ter acesso de leitura ao repositório privado do MASTER e gravação/criação nos repositórios das instalações, pois o mesmo fluxo publica o snapshot autorizado na Taveira.
   - Confirmar por chamada real que o commit e o `delta_version.txt` da branch principal podem ser lidos antes de liberar o botão.

4. **Corrigir o registro atual da Taveira**
   - Depois do código corrigido, alinhar `current_version` com `pinned_release` (**1.2.9**) e marcar `update_available`.
   - Não alterar saúde, verificações, histórico, credenciais da Taveira ou dados operacionais.

5. **Garantir contra regressão**
   - Testar que uma validação saudável não avança a versão instalada.
   - Testar que o status continua “atualização disponível” quando `pinned_release < MASTER_RELEASE_VERSION`.
   - Testar lista, detalhe e botão usando a mesma fonte de verdade.
   - Testar leitura autenticada do repositório e bloqueio explicativo quando a credencial faltar ou não tiver permissão.

6. **Fechamento MASTER-first**
   - Regenerar o pacote do MASTER, atualizar `delta_version.txt` e `MASTER_RELEASE_VERSION` para a mesma nova versão e manter o relatório de instalação coberto.
   - Rodar testes direcionados, `bun run master:check`, verificação de tipos e build.
   - Publicar o MASTER; então autorizar a atualização da Taveira e validar que ela passa a exibir uma única versão real.

## Resultado esperado

Antes da atualização, o MASTER mostrará a Taveira como **1.2.9 → nova versão do MASTER**, com “Atualização disponível”. Após configurar o token, publicar o MASTER e autorizar, o código da Taveira será efetivamente atualizado; só então a versão instalada e o status “Em dia” avançarão.

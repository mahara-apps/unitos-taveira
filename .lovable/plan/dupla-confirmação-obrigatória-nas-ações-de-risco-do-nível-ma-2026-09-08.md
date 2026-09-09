# Dupla confirmação obrigatória nas ações de risco do nível master

Objetivo: nenhuma ação crítica do nível master (super admin) pode ser executada
com um clique. Toda ação destrutiva ou de alto impacto passa a exigir digitar o
nome exato do alvo e fica registrada em histórico auditável.

## Padrão único de confirmação

Um componente único de confirmação crítica, reutilizado em todas as telas:

- Título com o verbo real ("Excluir cliente", "Atualizar instalação").
- Bloco de impacto em destaque: o que muda, o que se perde, se é reversível.
- Campo obrigatório: digitar o nome exato do alvo (cliente, workspace,
  instalação, recurso, usuário). Comparação sem diferenciar maiúsculas e
  espaços nas pontas.
- Botão de ação só habilita com o texto idêntico; mostra estado de carregando e
  não permite duplo envio.
- Fechar/cancelar limpa o texto digitado.
- Onde a ação afeta um ambiente de cliente (instalações), o diálogo também
  mostra a versão atual e a de destino antes de liberar o botão.

## Onde será aplicado

1. Instalações (`/admin/instalacoes/*`): provisionar, reprovisionar/reiniciar,
   atualizar, cancelar operação, sincronizar versão, concluir operação
   manualmente.
2. Exclusões com perda de dados: excluir cliente, excluir workspace, excluir
   pipeline inteiro, excluir conteúdos em massa. Onde já existe digitação
   (workspace, cliente, pipeline), unificar no mesmo padrão visual e garantir
   que nada dispare sem ela.
3. Configurações globais: ativar/desativar recursos e flags, identidade visual
   institucional, app Meta, limites de IA.
4. Usuários e permissões: promover/remover nível master, remover membro do
   workspace, redefinir senha de outro usuário, revogar convite e acessos do
   portal.

## Registro auditável

- Cada confirmação crítica grava um evento com: quem executou, quando, qual
  ação, qual alvo, resultado (sucesso/erro) e um resumo do impacto.
- O registro é feito no servidor, dentro da própria ação, depois da checagem de
  permissão — não pela tela, para não haver como burlar.
- Visualização em Configurações > Registros, com filtros por período, usuário e
  tipo de ação. Só nível master vê.

## Detalhes técnicos

- Novo componente `src/components/ui/critical-confirm-dialog.tsx` (props:
  título, impacto, `confirmText`, `onConfirm`, `pending`, `variant`).
  Reaproveita `isDeleteConfirmationValid` de `src/lib/workspace-admin.ts`,
  generalizada para qualquer alvo.
- Nova tabela `public.critical_action_events` (actor, action_key, target_type,
  target_id, target_label, brand_id, payload resumido, result, created_at) com
  GRANTs explícitos, RLS: insert por `service_role`/server function, leitura só
  por `is_super_admin`. Sem PII sensível no payload.
- Helper de servidor `src/lib/critical-audit.server.ts` +
  `logCriticalAction(...)` chamado nas server functions afetadas
  (`admin-environment.functions.ts`, `branding.functions.ts`,
  `feature-flags.functions.ts`, `meta/app-config.functions.ts`,
  `installation/manager.functions.ts`, `workspace.functions.ts`,
  `content.functions.ts`, funções de equipe/permissões).
- Server functions críticas passam a exigir `confirmLabel` no input e validam
  no servidor que ele corresponde ao alvo (defesa real, não só UI).
- Telas atualizadas: `admin.instalacoes.$id.tsx`, `admin.instalacoes.index.tsx`,
  `admin.recursos.tsx`, `admin.identidade.tsx`, `admin.meta.tsx`,
  `admin.ambiente.tsx`, `settings.ai-limits.tsx`, `settings.team.tsx`,
  `settings.permissions.tsx`, `customers.index.tsx`, `content.tsx`.
- Testes: unitário do componente (botão só habilita com texto exato), unitário
  da validação server-side de `confirmLabel`, integração de RLS do novo
  registro, e teste garantindo que cada ação crítica listada exige confirmação.
- MASTER-first: migration no MASTER, regenerar pacote delta, atualizar
  `delta_version.txt` e `MASTER_RELEASE_VERSION`, incluir a nova tabela na
  checagem 80 de `verify-installation.sql`, rodar `bun run master:check`,
  typecheck, testes e build antes de publicar.

## Fora de escopo

- Não altera quem tem poder (matriz de papéis permanece igual).
- Não adiciona segundo fator, senha ou aprovação por outra pessoa.
- Não altera RLS existente das demais tabelas.

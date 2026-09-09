# Central de mensagens como recurso ativável

## O problema

Hoje a Central de mensagens só aparece para o Super Admin. Dois motivos:

1. O endereço `/messages` não está na lista de telas liberadas para os papéis do workspace (Owner/Admin/Manager/User) — apenas o Super Admin ignora essa lista.
2. A Central não tem interruptor próprio: ela pega emprestado o recurso "Chat" (copiloto de IA), que vem desligado de fábrica. Ou seja, mesmo com o acesso liberado, ela dependeria de um recurso de outra finalidade.

## O que será feito

- Criar o recurso **Mensagens** na tela "Recursos do cliente", separado do Chat com IA, **ligado por padrão** em todo ambiente (novo e existente).
- Liberar a Central de mensagens para Owner, Admin, Manager e usuários com permissão, respeitando o perfil de acesso por módulo.
- Criar o módulo de permissão **Mensagens** (Nenhum / Ver / Próprios / Total), separando-o do módulo Chat, para que a equipe possa dar acesso à conversa sem abrir o copiloto de IA.
- Ao desligar o recurso, a tela sai do menu e o acesso direto pelo endereço também é bloqueado — sem tela em branco.
- O Chat com IA continua exatamente como está hoje (desligado por padrão), com o próprio interruptor.
- O portal do cliente (`/area/mensagens`) segue a mesma chave: se a agência desligar Mensagens, o cliente também não vê a aba.

## Detalhes técnicos

- Migração: nova linha em `feature_catalog` (`key = 'messages'`, categoria Gestão, `default_enabled = true`) e `INSERT` em `brand_features` habilitando o recurso para todos os workspaces já existentes.
- `src/lib/permissions.ts`: adicionar `/messages` a `SIDEBAR_ALLOWED_URLS` (admin e user).
- `src/lib/module-permissions.ts`: novo módulo `messages` (grupo Operação, urls `/messages`), retirando `/messages` do módulo `chat`.
- `src/components/app-sidebar.tsx`: `messagesItem.featureKey` passa de `chat` para `messages`.
- `src/routes/_authenticated/messages.tsx`: `beforeLoad: () => ensureFeatureEnabled("messages")`.
- `src/lib/messaging.functions.ts`: `assertModuleAccess(..., "messages", ...)` nos quatro pontos que hoje usam `"chat"`, além do gate de recurso no servidor.
- Portal: gate da aba de mensagens pela mesma chave `messages`.
- Testes de unidade para o novo módulo/permissão e para a lista de telas liberadas.

## MASTER-first

Migração aplicada no MASTER, pacote regenerado (`build_delta.py`), `delta_version.txt` + `MASTER_RELEASE_VERSION` em 1.3.17, cobertura em `verify-installation.sql` (recurso `messages` presente) e `bun run master:check` verde antes de publicar e propagar.

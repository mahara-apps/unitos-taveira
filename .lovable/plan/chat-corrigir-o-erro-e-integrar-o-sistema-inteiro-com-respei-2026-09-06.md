# Chat: corrigir o erro e integrar o sistema inteiro com respeito às permissões

## O que está causando o erro

Confirmado no banco: **todas as conversas do chat estão sem workspace** (`chat_conversations.brand_id` nulo nas 3 conversas existentes). O envio da mensagem exige o workspace para escolher a IA da conta, então ele para logo no início e cai na mensagem genérica "Ocorreu um erro inesperado. Nenhum conteúdo inválido foi salvo."

Por que ficou nulo: a tela "Iniciar nova conversa" (rota `/chat`) cria a conversa sem informar o workspace ativo, diferente da lista lateral, que informa.

A chave de IA da conta está correta: o Unitos Master tem Gemini como provedor de texto, verificado, com credenciais salvas. Não é problema de chave.

## Correções

1. Ao criar conversa, o servidor resolve o workspace ativo do usuário quando ele não vem da tela — nunca mais nasce conversa "sem conta".
2. No envio, se a conversa antiga estiver sem workspace, ele é resolvido pelo vínculo do usuário e gravado na conversa (conserta as conversas já existentes ao usar).
3. Se realmente não houver workspace ou IA configurada, mostrar aviso claro e acionável ("selecione um workspace" / "configure a IA em Conexões") em vez de "erro inesperado".

## Integração completa com o sistema

Hoje o chat só consulta: clientes, posts por título, tarefas atrasadas, criar tarefa e memória do Brain. Vou ampliar para cobrir a operação toda, sempre em leitura por padrão:

- Clientes (ficha, responsável, situação) e projetos (status, prazos, andamento)
- Tarefas (minhas, do time, por cliente/projeto, atrasadas, concluídas)
- Pauta/planejamento mensal e aprovações
- Conteúdo e calendário (agendados, publicados, aguardando aprovação)
- Briefings (existência, completude, última atualização)
- Pedidos e mensagens da Área do Cliente
- Horas/timesheet (por pessoa, cliente, projeto, período)
- Equipe e usuários (quem é quem, papel, clientes atribuídos)
- Situação das conexões (Meta, WhatsApp) — sem expor chaves nem tokens
- Números de resumo (visão geral do período) e memória do Brain

Cada resposta traz link para a tela correspondente, para o usuário abrir e resolver.

## Hierarquia e permissões (obrigatório)

- O chat monta as consultas disponíveis a partir do nível de permissão por módulo do usuário: módulo em "Nenhum" simplesmente não existe para ele no chat.
- "Ver" e "Ver + Próprios" limitam ao que ele já veria nas telas; criar/alterar (ex.: criar tarefa) só com nível Total.
- Escopo por cliente continua valendo: Manager e Usuário só enxergam clientes atribuídos; Owner/Admin, todo o workspace.
- Tudo continua rodando na sessão do próprio usuário (nunca com acesso privilegiado), então a proteção do banco permanece como última barreira.
- Contas do Portal do Cliente não têm chat interno em nenhuma hipótese.
- Toda consulta feita e o resultado ficam registrados na conversa, para auditoria.

## Detalhes técnicos

- `src/lib/chat.functions.ts`: `createChatConversationFn` resolve `brand_id` via vínculo do usuário quando `brandId` não vier.
- `src/routes/api/chat.stream.ts`: backfill de `brand_id` na conversa; erro `brand_id ausente` / `ai_provider_not_configured` classificado como falha de configuração (mensagem específica, HTTP 409), não `unknown`.
- `src/lib/ai-failures.server.ts`: novo tipo de falha "configuração" com texto pt-BR acionável.
- `src/lib/brain/chat-gateway/tools.server.ts`: catálogo de tools expandido; `buildChatTools` passa a receber o mapa de permissões efetivas (`effective_module_permissions`) + papel/escopo (`src/lib/access-guard.ts`, `src/lib/module-permissions.ts`) e registra apenas as tools permitidas; writes exigem `full`.
- Reuso das consultas já existentes de `src/lib/brain/reasoning/tools.server.ts` (projetos, tarefas, posts, clientes) e do relatório de horas (`src/lib/timesheet-report.ts`) em vez de duplicar SQL.
- Testes: `tests/chat-tools-permissions.test.ts` (gating por nível/papel), `tests/chat-conversation-brand.test.ts` (resolução/backfill do workspace).
- Regenerar deltas e subir `MASTER_RELEASE_VERSION` só se houver mudança de banco (não prevista: nenhuma tabela nova).

# Comunicação de mão dupla com a área do cliente

Tudo que o cliente faz no portal passa a chegar em você, e tudo que a equipe responde passa a chegar no cliente — sem e-mail, só dentro do sistema.

## O que está errado hoje

- Aprovação e pedido de ajuste avisam só o responsável pelo cliente, quem está ligado a ele e quem é dono/gerente do espaço. Quem é admin ou usuário comum não recebe nada.
- Comentários do cliente não geram aviso e não existe nenhuma tela interna para ler ou responder.
- Pedidos do cliente avisam a equipe, mas não há tela para responder e o cliente nunca é avisado do andamento.
- Briefing enviado ou revisado pelo cliente também não avisa ninguém.

## O que vamos entregar

### 1. Caixa de entrada do cliente (nova tela)

Uma lista única com tudo que chegou de todos os clientes: pedidos, comentários, aprovações, ajustes e briefings. Filtros por cliente, por tipo e por “sem resposta”. Cada linha abre a conversa e permite responder ali mesmo. Contador de itens sem resposta no menu.

### 2. Mesma conversa dentro da ficha do cliente

Uma aba “Área do cliente” em cada cliente, mostrando a mesma conversa filtrada só naquele cliente, com:

- pedidos com mudança de situação (recebido, em andamento, concluído, recusado) e campo de resposta;
- comentários do cliente com resposta da equipe na mesma linha do tempo;
- histórico de aprovações e ajustes, com o texto do ajuste em destaque.

### 3. Avisos para a equipe

Passa a avisar em toda ação do cliente: aprovou, pediu ajuste, rejeitou, comentou, abriu pedido, respondeu pedido, enviou briefing. Recebem: o responsável pelo cliente, quem está ligado ao cliente e os admins/owners do espaço. Cada aviso leva direto para o item.

### 4. Avisos para o cliente

O cliente passa a receber na aba “Avisos” do portal quando: a equipe responde um comentário, a situação de um pedido muda, um conteúdo novo entra para aprovação ou um arquivo é liberado. Respeita as preferências de avisos que ele já tem na conta.

### 5. Sem resposta = pendência visível

Item do cliente sem resposta da equipe aparece marcado na caixa de entrada e no resumo do cliente, para nada ficar esquecido.

## Detalhes técnicos

- Corrigir a lista de destinatários da função `portal_decide` (migration): incluir papéis `admin`, `super_admin` e `user` além de owner/manager, mantendo o filtro de pertencer ao espaço e o `dedupe_key`.
- `post_client_comments`: permitir escrita com `author_side = 'team'` por nova server function autenticada com guard de escopo do cliente; hoje a tabela só é escrita pelo portal.
- `client_requests` + `client_request_events`: novas server functions internas para listar, mudar situação e responder, gravando evento e disparando aviso ao cliente.
- Novo módulo `src/lib/client-inbox.functions.ts` agregando pedidos, comentários, decisões e briefings por espaço/cliente, respeitando escopo por cliente (owner/admin cobrem o espaço; manager/user só clientes atribuídos) e as permissões por módulo já existentes.
- Avisos para o cliente via `notifications` com `user_id` dos contatos de portal do cliente, filtrando por `portal_notification_prefs`; nada de e-mail nesta fase.
- Avisos internos reutilizam `insertNotificationsDeduped` para não repetir aviso não lido do mesmo item.
- Coluna nova em `client_requests` para marcar última resposta da equipe (`last_team_reply_at`), usada no indicador “sem resposta”.
- KPIs da caixa de entrada usam `PageKpi`/`PageKpiGrid`; datas no fuso de Brasília via `src/lib/timezone.ts`.
- Testes: destinatários dos avisos por papel, escopo por cliente, resposta da equipe gravando `author_side='team'`, e aviso ao cliente respeitando preferências.
- Regenerar o pacote de deltas e subir `MASTER_RELEASE_VERSION` para propagar a correção às instalações derivadas (incluindo a Taveira, onde o seu ajuste provavelmente foi registrado).

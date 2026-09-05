# Área do cliente: pedidos, avisos, conta e aprovação mais rica

Inspirado no fluxo do Operand, mantendo uma única área do cliente (`/area/*` com login e o link sem senha somente para acompanhar).

## O que existe hoje (verificado)

- Sete seções: Início, Aprovações, Pauta, Calendário, Briefing, Arquivos, Minha Marca — com permissões por cliente.
- Aprovação registra apenas decisão + um texto (`post_approvals`: status, notas, quem decidiu). Não há histórico de conversa, nem anexo enviado pelo cliente, nem prazo do cliente.
- Existe uma central de avisos no sistema interno (tabela `notifications` com título, link e lido), mas o cliente não vê nada disso no portal e não escolhe o que recebe por e-mail.
- Não existe nenhum lugar para o cliente pedir uma nova demanda.
- O primeiro acesso hoje só funciona com senha temporária gerada pela equipe.

## 1. Cliente pede novas demandas

- Nova seção "Pedidos" no portal: lista dos pedidos do cliente com situação (em análise, aceito, recusado, em produção, concluído), quem é o responsável na agência e prazo.
- Formulário: título, projeto (dos projetos daquele cliente), prazo sugerido, descrição e anexos.
- Do lado da agência: os pedidos aparecem na ficha do cliente para aceitar (virando tarefa/projeto real), pedir mais informação ou recusar com motivo. O cliente pode cancelar um pedido ainda não aceito, com aviso na tela de que a equipe pode já ter começado.
- Nova permissão por cliente: "Pedidos" (sem acesso / só ver / criar pedidos).

## 2. Avisos dentro do portal e por e-mail

- Sino no cabeçalho do portal com os avisos daquele cliente (novo conteúdo para aprovar, prazo chegando, resposta da equipe, pedido respondido) levando direto ao item.
- Tela "Meus avisos" com marcar como lido e histórico.
- Preferências de e-mail por contato: quais tipos de aviso ele quer receber, com um resumo diário opcional.
- Reaproveita a estrutura de avisos já existente, filtrada com rigor para o cliente ver somente o que é dele.

## 3. Minha conta

- Tela de conta no portal: nome, foto, e-mail de acesso, trocar senha e "esqueci minha senha".
- Troca de e-mail passa por confirmação no novo endereço.

## 4. Comentar, anexar e marcar na peça

- Cada conteúdo em aprovação ganha uma conversa: mensagens da equipe e do cliente em ordem, com anexos (imagem, PDF, documento) e indicação de quem escreveu.
- Marcação na imagem: o cliente clica num ponto da peça, escreve o ajuste, e a equipe vê o pino sobre a arte. Vale para imagens e capas de vídeo; para vídeo o comentário guarda o tempo.
- Quem só tem permissão de acompanhar continua vendo tudo, sem escrever.

## 5. Prazo do cliente visível

- Cada conteúdo em aprovação passa a ter prazo para o cliente responder, definido pela equipe (ou herdado da etapa do fluxo).
- No portal: etiqueta com "faltam X dias", cor de atenção quando está perto e de atraso quando passou; Início mostra quantos itens estão no prazo, em atenção e atrasados.

## 6. Primeiro acesso

- Ao criar um contato, a equipe escolhe: enviar e-mail com link para o cliente criar a própria senha, ou gerar senha temporária para repassar.
- O link expira e só serve uma vez; a senha temporária continua exigindo troca no primeiro login.

## Detalhes técnicos

- Banco (migrations com GRANT + RLS por cliente, seguindo o padrão do portal):
  - `client_requests` e `client_request_events` (pedidos, situação, responsável, prazo, anexos, histórico).
  - `post_client_comments` (mensagens do fluxo de aprovação, autor, anexos, coordenadas `x`/`y` ou tempo do vídeo para a marcação).
  - `posts.client_due_at` para o prazo do cliente; fallback pela etapa do pipeline já existente.
  - `portal_notification_prefs` por contato (`client_members`), e leitura de `notifications` pelo portal via função `SECURITY DEFINER` restrita ao cliente da sessão.
  - Bucket/pasta de anexos do cliente com política por cliente; leitura sempre por URL assinada.
- Servidor: novas server functions `portal-requests.functions.ts`, `portal-comments.functions.ts`, `portal-notifications.functions.ts`, `portal-account.functions.ts`, todas passando por `assertPortalAccess` com o módulo correspondente; link sem senha permanece somente leitura.
- Permissões: acrescentar os módulos `requests` e `notifications` ao catálogo em `src/lib/portal-permissions.ts` e ao painel de configuração do cliente.
- Interno: fila de pedidos na ficha do cliente, conversa do conteúdo espelhada no fluxo de aprovação interno e campo de prazo do cliente no editor de conteúdo.
- Primeiro acesso: convite com link de definição de senha (token de uso único) além do caminho atual de senha temporária.

## Validação

- Testes de isolamento: contato de um cliente não lê pedidos, conversas, anexos nem avisos de outro cliente; link sem senha não cria pedido, comentário nem marcação.
- Testes das permissões novas (sem acesso / ver / interagir) e do cálculo de prazo (no prazo, atenção, atrasado).
- Verificação em celular e desktop das seções novas, com estados vazios, carregando e erro.

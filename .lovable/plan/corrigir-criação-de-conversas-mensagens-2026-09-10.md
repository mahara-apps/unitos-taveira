# Corrigir criação de conversas (Mensagens)

## O que está acontecendo

Nenhuma conversa jamais foi criada nesta instalação: as tabelas de conversas,
participantes e mensagens estão todas vazias (0 registros). Ou seja, não é um
caso isolado do cliente "Dome" nem do seu usuário — a criação está quebrada
para todos os níveis de acesso (Super Admin, Owner, Admin, Manager, User) e
também para conversas internas da equipe.

## Causa raiz (mapeada)

A permissão de criação da conversa está correta: o seu usuário passa em todas as
checagens de workspace e de cliente (o cliente Dome aparece na lista justamente
porque a checagem de escopo aprova).

O bloqueio vem de um detalhe da regra de leitura. Ao criar a conversa, o sistema
pede o registro de volta na mesma operação. Isso obriga o banco a validar também
a regra de *leitura* daquela linha, e essa regra consulta a conversa numa função
que ainda não "vê" a linha recém-criada (ela é criada e consultada no mesmo
instante). O resultado é sempre a mensagem
"new row violates row-level security policy for table message_threads",
independentemente do papel do usuário.

Duas falhas adicionais do mesmo fluxo, encontradas no mapeamento:

1. Conversa interna da equipe (tipo "Equipe"): mesmo que o passo acima fosse
   corrigido, o primeiro participante nunca pode ser inserido, porque a regra
   exige que a pessoa já seja participante da conversa que ela acabou de criar.
   Impasse permanente.
2. Conversa é criada em uma operação e participantes em outra: se a segunda
   falhar, sobra uma conversa órfã, invisível para todos.

## Correção proposta

Criar no banco uma rotina única e validada de criação de conversa, que:

- confere workspace, cliente/projeto e papel do autor com as mesmas regras
  oficiais já usadas hoje (nada de permissão nova ou mais frouxa);
- cria a conversa e os participantes numa só transação (sem conversa órfã);
- resolve o impasse do primeiro participante em conversas de equipe;
- devolve o identificador da conversa sem depender da regra de leitura no mesmo
  instante da criação.

O código de Mensagens passa a chamar essa rotina em vez de inserir a conversa
diretamente. A tela de "Nova conversa" não muda visualmente.

Também revisamos o fluxo equivalente do Portal do cliente para garantir que
respostas e novas conversas do portal não caiam no mesmo problema, mantendo o
isolamento atual (contato só vê conversa compartilhada do próprio cliente).

## Simulações e validação

Antes e depois da correção, rodar simulação controlada no banco (em transação
revertida, sem gravar dados) para cada nível: Super Admin, Owner, Admin, Manager
com cliente atribuído, Manager sem atribuição, User atribuído, User sem
atribuição e contato do Portal. Verificar em cada caso:

- criação de conversa de cliente interna;
- criação de conversa de cliente compartilhada;
- criação de conversa de equipe;
- tentativa fora de escopo (deve continuar sendo negada);
- leitura, entrada de participantes e envio da primeira mensagem.

Depois, teste real no preview: criar uma conversa de cliente e uma de equipe,
enviar mensagem, recarregar e confirmar que aparecem na lista.

## Detalhes técnicos

- Nova função `public.create_message_thread(...)` (SECURITY DEFINER, `search_path
  = public`), reaproveitando `is_brand_member`, `can_access_client`,
  `can_access_project`, `has_module_access` e a normalização de papéis existente;
  `GRANT EXECUTE ... TO authenticated`.
- Ajuste da policy de INSERT em `message_thread_participants` para aceitar também
  `EXISTS (select 1 from message_threads t where t.id = thread_id and
  t.created_by = auth.uid() and is_brand_member(t.brand_id, auth.uid()))`,
  cobrindo o primeiro participante de conversas `team_dm`.
- `createThread` em `src/lib/messaging.functions.ts` passa a usar `callRpc`
  (`src/lib/supabase-rpc.ts`) para a nova função; guards de feature/módulo/escopo
  permanecem no servidor.
- Revisão de `src/lib/portal-messages.functions.ts` (inserts com `.select()`
  sujeitos ao mesmo padrão).
- Testes: cenários de criação em `tests/` (unitário do contrato + simulação SQL
  documentada).
- MASTER-first: migration + `build_delta.py`, `delta_version.txt` e
  `MASTER_RELEASE_VERSION` sincronizados, cobertura em
  `supabase/install/verify-installation.sql` (nova função na checagem), e
  `bun run master:check` antes de publicar.

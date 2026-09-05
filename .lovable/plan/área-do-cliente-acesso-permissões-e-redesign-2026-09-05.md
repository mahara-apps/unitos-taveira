# Área do Cliente: acesso, permissões e redesign

Uma única área do cliente (`/area`), sem rota nova e sem duplicação. O login é o mesmo do sistema; ao entrar, quem é contato de cliente vai direto para a área do cliente e nunca alcança dados internos nem de outros clientes.

## 1. Criação do acesso (fluxo em etapas)

No cadastro do cliente, a seção "Acesso por login" vira um assistente em 3 etapas, no espírito do exemplo enviado:

- **Etapa 1 — Contatos:** adicionar vários contatos (nome + e-mail) do mesmo cliente. Cada contato ganha login próprio, por convite por e-mail ou por senha provisória exibida uma única vez.
- **Etapa 2 — Atendimento:** responsável padrão da equipe para as solicitações daquele cliente (informativo/roteamento de notificações).
- **Etapa 3 — Permissões:** o que o cliente pode ver e fazer, definido **por cliente** (vale para todos os contatos): Aprovações, Pauta, Calendário, Briefing, Arquivos, Comentários — cada item em Ver / Ver + interagir / Nenhum.

Também na mesma tela: lista de contatos com status (pendente de senha / ativo / último acesso), reenviar convite, gerar nova senha, desativar acesso.

## 2. Fim do acesso por link sem senha

O acesso por token é aposentado: as telas `/portal/$token/*` saem, os links existentes passam a levar para a tela de login com aviso, e os tokens ativos são revogados. As mesmas telas continuam existindo uma única vez, agora só sob `/area`.

## 3. Isolamento (não negociável)

- Cliente final nunca entra na área interna: quem só tem vínculo de cliente é levado para `/area`.
- Toda leitura do portal continua presa ao cliente do vínculo, validado no banco; ID de cliente que não pertence ao usuário resulta em erro explícito, nunca em dados de outra marca.
- As permissões da etapa 3 são checadas no servidor, não só escondendo botões.

## 4. Redesign da área do cliente

Vou gerar 3 direções visuais renderizadas da área do cliente para você escolher; depois implemento a escolhida.
Compromissos em qualquer direção:

- Mobile primeiro: navegação inferior fixa com alvos grandes, cartões de aprovação em pilha, ações principais sempre alcançáveis com o polegar.
- Início como painel de decisão: "o que precisa de você agora", prazos e próximos conteúdos.
- Estados de carregando, vazio e erro com nova tentativa em todas as telas; identidade e cor do cliente aplicadas ao cabeçalho, sem quebrar contraste.

## Detalhes técnicos

- `client_members` passa a aceitar vários registros `portal_client` por cliente; a checagem "já existe acesso" sai do fluxo de criação.
- Permissões do portal em nova tabela por cliente (padrão: aprovar e comentar liberados, arquivos e briefing em leitura), com policies e leitura via função de servidor.
- Server functions do portal deixam de aceitar token; `portal-scope.server.ts` mantém só o caminho autenticado; `portal_tokens` e rotas `portal.$token.*` são removidas junto com `resolvePortalTokenFn`.
- Convite reaproveita o padrão já usado para equipe (senha provisória + troca obrigatória), sem colocar o contato em `brand_members`.
- Testes: isolamento entre clientes, permissão negada no servidor, múltiplos contatos e ausência de rota por token.

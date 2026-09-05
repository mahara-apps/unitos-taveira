# Acesso do cliente com usuário e senha (assistente em 3 etapas)

Hoje o botão que você usou gera um **link sem senha**. Ele abre o portal, mas não cria conta nenhuma — por isso ninguém recebeu usuário e senha. O caminho que cria login existe, mas está escondido dentro do card do link, então na prática não é encontrado.

O ajuste: transformar a criação de acesso em um assistente claro, no espírito das referências que você enviou, e deixar o link sem senha como opção secundária de acompanhamento.

## 1. Novo botão "Acesso do cliente"

Na ficha do cliente, um botão em destaque abre o assistente **Acesso do Cliente** com 3 etapas na coluna da esquerda e marca de concluído, como nas referências:

- **Etapa 1 — Cliente e contatos:** nome + e-mail de cada pessoa do cliente, com botão "Adicionar" e lista dos contatos já incluídos. Cada contato entra como conta própria; ao finalizar, escolhe-se entre **enviar convite por e-mail** ou **exibir uma senha provisória** uma única vez (as duas formas já funcionam). O contato troca a senha obrigatoriamente no primeiro acesso.
- **Etapa 2 — Equipe de atendimento:** responsável padrão da agência para os pedidos daquele cliente (usado no roteamento de avisos).
- **Etapa 3 — Permissões:** o que o cliente pode ver e fazer, por cliente (valendo para todos os contatos). Duas colunas de chaves: **Visualizar** e **Criar / Editar**, por item — Aprovações, Pauta, Calendário, Briefing, Arquivos, Comentários, Pedidos. Painel lateral explica em texto simples o efeito de cada chave, como na referência.

Rodapé fixo com "Cancelar" e "Próximo" / "Salvar", e na tela de contatos: status (pendente de senha / ativo / último acesso), reenviar convite, gerar nova senha, desativar acesso.

## 2. Entrada pela mesma tela de login

O cliente entra pelo mesmo `/login` do sistema. Ao autenticar, quem é contato de cliente é levado direto para a área do cliente e nunca vê a área interna — hoje esse desvio já existe no controle de acesso, mas a tela de login manda todo mundo para o painel interno primeiro, gerando um pisca. Vai passar a resolver o destino no próprio login.

## 3. Link sem senha vira acompanhamento

O card do link continua existindo, mas rebaixado: rótulo claro de "acesso de acompanhamento, somente leitura", sem competir com a criação de acesso. Nada de link existente para de funcionar.

## 4. Ambiente fechado

- Contato de cliente não entra em nenhuma tela interna nem vê dados de outro cliente; a checagem continua no banco, por cliente.
- As permissões da etapa 3 são verificadas no servidor, não apenas escondendo botões.
- Contato de cliente não é membro da agência em nenhuma hipótese.

## Detalhes técnicos

- Novo `client-access-wizard.tsx` (3 passos) reaproveitando `portal-accounts.functions.ts` (criar/reenviar/remover contato) e `portal-config.functions.ts` (permissões + responsável). `PortalAccessSection` passa a ser a lista de contatos dentro do wizard, saindo de dentro de `portal-link-card.tsx`.
- `portal-permissions.ts` ganha o nível de escrita explícito por módulo (`none | view | interact`) mapeado nas duas chaves da UI, mantendo o padrão atual como valor inicial; `portal_permissions()` e os guards de servidor (`portal-scope.server.ts`, `usePortalCanInteract`) seguem como fonte única.
- `login-form.tsx` consulta o acesso de portal (`getMyPortalAccessFn`, já em cache) e navega para `/area/inicio` quando o usuário só tem vínculo de cliente.
- Convite por e-mail usa o mesmo remetente/template já usados para equipe.
- Testes: criação de vários contatos, permissão negada no servidor, isolamento entre clientes e destino de login por tipo de usuário.

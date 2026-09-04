# Exclusividade de conta social por cliente

Hoje o diálogo "Vincular canal" lista todas as contas do workspace, escondendo apenas as já vinculadas **a este** cliente. Contas que já pertencem a outro cliente continuam aparecendo como disponíveis (ex.: @drapribrito no Cliente Teste). Não existe nenhuma trava no servidor nem no banco impedindo o vínculo duplo — hoje nenhuma conta está em dois clientes, então a correção pode ser aplicada sem limpeza de dados.

## Regra a implementar

Uma conta social (Página do Facebook / Instagram Business) pode estar vinculada a **no máximo um cliente** por vez. Para mover a conta, é preciso desvinculá-la do cliente atual.

## O que muda

1. **Diálogo "Vincular canal"** (`channels-tab.tsx`)
   - Só ficam selecionáveis contas sem nenhum cliente vinculado.
   - Contas de outro cliente aparecem em uma seção separada "Já vinculadas a outro cliente", em estado desabilitado, com badge mostrando o nome do cliente e o botão trocado por "Indisponível". Isso evita a impressão de que a conta "desapareceu".
   - Se não houver nenhuma conta livre, mensagem explicando que todas as contas conectadas já estão atribuídas, com link para Integrações.

2. **Trava no servidor** (`toggleClientChannelFn`)
   - Antes de inserir, verificar se a conexão já tem vínculo com outro cliente; se tiver, erro claro: "Esta conta já está vinculada ao cliente X. Desvincule-a antes de atribuir a outro cliente."

3. **Trava no banco**
   - Índice único em `client_social_accounts (connection_id)`, garantindo exclusividade mesmo em requisições concorrentes.

Nada muda no fluxo de conexão Meta, na listagem de canais já vinculados, no agendamento ou na publicação.

## Detalhes técnicos

- `listWorkspaceChannelsFn` já retorna `clients[]` por conexão — a UI só precisa usar esse dado; nenhum server fn novo.
- Migração: `CREATE UNIQUE INDEX uq_client_social_accounts_connection ON public.client_social_accounts (connection_id);` (sem conflitos: verificado, zero conexões com mais de um cliente).
- Mensagem de erro do servidor resolve o nome do cliente atual via join em `clients`.

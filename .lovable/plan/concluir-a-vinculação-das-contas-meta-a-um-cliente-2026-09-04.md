# Concluir a vinculação das contas Meta a um cliente

Hoje, ao autorizar a Meta e abrir "Selecione as contas da Meta", a tela lista os perfis e cada
chave liga a conta imediatamente ao workspace — mas não existe rodapé, resumo nem passo para
dizer **a qual cliente** aquelas contas pertencem. A única saída é o "X", o que deixa a
impressão de que nada foi concluído.

## O que vai mudar (visual e fluxo)

1. **Cabeçalho claro**
   - Título visível "Selecione as contas da Meta" com subtítulo: "Ative as contas que você quer
     usar e depois escolha o cliente."
   - "Sincronizar" continua no mesmo lugar.

2. **Resumo de seleção fixo no rodapé**
   - "N conta(s) ativada(s) nesta sessão" com os nomes das últimas ativadas.
   - Aviso curto: contas ativadas já ficam salvas no workspace, mesmo se a tela for fechada.

3. **Escolha do cliente no próprio rodapé**
   - Um seletor "Vincular ao cliente" com a lista de clientes do workspace (busca por nome).
   - Botão **Vincular e concluir**: aplica o vínculo das contas ativadas ao cliente escolhido e
     fecha a tela com confirmação ("2 contas vinculadas a Taveira").
   - Botão secundário **Concluir sem cliente**: mantém as contas no workspace para vincular
     depois na aba do cliente. Assim ninguém fica preso na tela.
   - Se a tela foi aberta já dentro de um cliente, o seletor vem preenchido e travado nesse
     cliente.

4. **Conta já vinculada a outro cliente**
   - Mensagem explicando qual cliente já usa aquela conta e o que fazer (desvincular primeiro),
     em vez de erro genérico.

5. **Fechar pelo "X"**
   - Passa a confirmar: "As contas ativadas ficaram salvas no workspace. Vincular a um cliente
     agora?" — com as opções Vincular / Sair.

6. **Um único caminho — fim da segunda tela**
   - Hoje, se você fecha o "Conectar canais", o sistema reabre um segundo modal
     ("Selecione as contas da Meta") por um caminho antigo, e a conexão aparece como um grupo
     solto sem cliente — só dá para vincular pelos três pontinhos. Esse caminho antigo sai de
     cena: a seleção de contas passa a acontecer sempre dentro do mesmo modal "Conectar canais",
     nas etapas Autorização → Ativos → Cliente → Confirmação.
   - Se a tela for fechada no meio, um aviso no topo da tela de Conexões oferece "Retomar
     seleção de contas", em vez de abrir outro modal sozinho.
   - O grupo "Sem cliente" continua existindo como lista, mas com um botão claro
     "Vincular a um cliente" em vez de depender do menu de três pontinhos.

7. **Mensagem de limite da Meta mais clara** (anexos)
   - "Permissões validadas parcialmente" e "Sincronização temporariamente limitada" passam a
     dizer, em uma frase, o que isso significa na prática: "Carregamos 189 contas de 177
     portfólios. A Meta pausou novas leituras por alguns minutos — você já pode selecionar e
     vincular as contas que apareceram."
   - Os detalhes técnicos da Meta continuam disponíveis, mas recolhidos em "Ver detalhes".
   - Quando 0 contas do Instagram aparecem por causa do limite, a mensagem explica que faltam
     leituras e que sincronizar de novo mais tarde completa a lista — sem sugerir reautorizar.
   - O botão "Selecionar ativos" ganha contador ("Selecionar ativos · 189") para deixar óbvio que
     há o que escolher na próxima etapa.


## Detalhes técnicos

- `src/components/connections/meta-portfolio-dialog.tsx`: `MetaAssetsPanel` recebe um rodapé
  opcional (`renderFooter` / props de conclusão) e passa a registrar os `connectionId` ligados
  na sessão atual; `MetaPortfolioDialog` ganha header visível + rodapé com seletor de cliente,
  "Vincular e concluir" e "Concluir sem cliente".
- Vínculo por cliente reutiliza `toggleClientChannelFn` (`src/lib/client-channels.functions.ts`)
  — nenhuma alteração de backend, RLS ou schema. A exclusividade por cliente já é validada lá,
  e a mensagem de erro dela será exibida como texto explicativo.
- Lista de clientes vem da server function já usada nas telas de conexões (mesma origem de
  `clients-channels-table.tsx`), sem nova consulta ao banco.
- Invalidação de cache mantém as chaves atuais (`meta-connections`, `client-channels`,
  `channels-kpis`, `social-analytics`).
- O fluxo dentro do modal "Conectar canais" (etapa Ativos) mantém o botão "Concluir" atual e
  apenas herda o seletor de cliente quando nenhum cliente estiver definido.
- Testes: caso unitário para a regra de conclusão (contas ativadas + cliente escolhido → vínculo;
  sem cliente → conclui mantendo no workspace) e para o texto de limite parcial da Meta.
- Fluxo único: `channels-center.tsx` e `routes/_authenticated/connections.tsx` deixam de abrir
  `MetaPortfolioDialog` como modal paralelo; a etapa Ativos vive só em `connect-channels-dialog.tsx`.
  O wrapper legado é mantido apenas para retomada explícita ("Retomar seleção de contas").
- Mensagens de limite/parcialidade reaproveitam `classifyMetaIssue` / `issue-messages.ts`; nenhum
  ajuste em varredura, orçamento de requisições ou cache de descoberta.


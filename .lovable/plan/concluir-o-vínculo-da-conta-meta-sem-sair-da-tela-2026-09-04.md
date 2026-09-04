# Concluir o vínculo da conta Meta sem sair da tela

A tela do print ainda é a versão antiga: ela só diz "conta vinculada" e o único caminho é o "X".
Na versão atual do MASTER já existe um rodapé com "Vincular e concluir" / "Concluir sem cliente",
mas ele fica no fim da lista (189 contas), então na prática continua fácil não ver.
E o ambiente da Taveira ainda não recebeu essa versão — por isso lá o comportamento é o antigo.

## O que muda

1. **Rodapé sempre visível**
   - A barra de conclusão passa a ficar fixa na base da janela, fora da lista que rola.
   - Mostra "N conta(s) ativada(s)" com os nomes, o seletor "Vincular ao cliente" e os botões
     **Vincular e concluir** / **Concluir sem cliente**.
   - Enquanto nada foi ativado: "Ative as contas que você quer usar" com os botões desabilitados.

2. **Aviso ao ativar a primeira conta**
   - A confirmação "Conta vinculada" passa a dizer: "Conta ativada — escolha o cliente no rodapé
     para concluir", em vez de sugerir que o processo terminou.

3. **Fechar pelo "X"**
   - Se existem contas ativadas e nenhum cliente escolhido, aparece uma confirmação: "As contas
     ficaram salvas no workspace. Vincular a um cliente agora?" com as opções Vincular / Sair.

4. **Linha "Sem cliente vinculado"**
   - Ganha o botão direto **Vincular a um cliente** (hoje é preciso descobrir os três pontinhos),
     mantendo "Ver canais" ao lado.

5. **Levar a correção para a Taveira**
   - Depois de validar aqui, a instalação da Taveira precisa ser atualizada pelo painel de
     Instalações para passar a mostrar o novo rodapé.

## Detalhes técnicos

- `src/components/connections/meta-portfolio-dialog.tsx`: mover a lista para um container com
  `min-h-0` + rodapé `sticky`/fora do scroll; `MetaAssignFooter` recebe estado de "confirmar
  fechamento"; ajustar o toast de `linkMetaAccount`.
- `MetaPortfolioDialog`: `DialogContent` em coluna flex com altura máxima, para o rodapé nunca
  sair do campo de visão; mesma estrutura aplicada ao passo Ativos de
  `connect-channels-dialog.tsx` (o rodapé auxiliar atual deixa de duplicar a mensagem).
- `clients-channels-table.tsx`: botão "Vincular a um cliente" na linha sem cliente, reusando o
  `LinkClientDialog` já existente.
- Vínculo continua via `toggleClientChannelFn`; nenhuma mudança de schema, RLS ou server function.
- Testes: unidade para a regra de conclusão (com cliente → vincula; sem cliente → conclui) e para
  o estado desabilitado sem contas ativadas.

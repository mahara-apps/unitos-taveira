# Correção do campo Local e ampliação do composer

## Objetivo
Restaurar a digitação normal no campo **Local**, mantendo o texto visível dentro do input, e ampliar o modal do composer em 20% para melhorar a distribuição do conteúdo.

## Alterações
1. **Corrigir o campo Local**
   - Separar o input do gatilho do popover de sugestões, eliminando a disputa de foco atual.
   - Manter o foco e o cursor no input durante toda a digitação.
   - Exibir o painel de sugestões somente abaixo do campo, sem substituir, cobrir ou capturar o texto digitado.
   - Continuar permitindo texto livre quando não houver local selecionado e manter a seleção de um resultado real do Instagram.

2. **Ampliar o modal em 20%**
   - Alterar a largura do composer de **1080 px para 1296 px**.
   - Aumentar a altura útil em 20%, limitada automaticamente pelo viewport para não sair da tela.
   - Redistribuir as duas colunas proporcionalmente, dando mais espaço ao formulário sem prejudicar o preview.

3. **Validação visual e funcional**
   - Testar digitação contínua, foco, busca após 2 caracteres, seleção de sugestão e texto livre.
   - Confirmar que o valor permanece dentro do input e é preservado ao salvar/reabrir o rascunho.
   - Verificar o modal no viewport atual e em largura menor, sem sobreposição do rodapé, popover ou campos.

## Escopo técnico
Somente apresentação e interação do composer em `ScheduleWizard` e seu tamanho `composer`; sem mudanças na API, banco de dados ou regras de agendamento/publicação.

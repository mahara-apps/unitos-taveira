# Reformulação visual das telas de Pautas

## Objetivo
Reorganizar apenas a apresentação da lista e do detalhe interno de Pautas conforme a referência enviada, preservando todas as ações, validações, permissões, dados e fluxos existentes. A única ampliação funcional será a seleção de modelo de IA, confirmada pelo usuário.

## Pauta mensal (`/monthly-plan`)
- Reorganizar o topo “Volumetria e geração do mês” e manter os três atalhos atuais: Peça expressa, Pauta expressa e Gerar pauta com IA, com a geração por IA como ação roxa principal.
- Manter os cartões de volumetria no padrão `PageKpi`/`PageKpiGrid`, destacando total, canal, base semanal/mensal, excedente, formatos com quantidades, gerados, disponíveis e percentual da cota.
- Reformular “Pautas deste cliente” com os quatro KPIs canônicos, abas Ativas/Arquivadas/Todas, filtro por projeto, busca e Nova pauta.
- Dar às linhas maior hierarquia visual para título, status, projeto/tarefas, contagens, autor, data e menu, sem alterar abertura, vínculo, arquivamento, restauração ou exclusão.

## Assistente “Gerar pauta com IA”
- Trocar o modal atual por um painel lateral responsivo usando o componente de painel do design system.
- Organizar o conteúdo em Contexto, modelo, canais, formatos e quantidades, com steppers e resumo do total dentro ou acima da cota.
- Preservar tema, versão de briefing, projeto obrigatório, seleção de canais/formatos, cálculo de cota/excedente, solicitação de liberação, estados de erro e carregamento.
- Tornar a seleção de modelo funcional: listar somente modelos operacionais dos provedores configurados para o workspace, validar a escolha novamente no servidor e executar a geração pelo modelo escolhido. Sem chave exposta ao navegador e sem substituir a arquitetura BYOK existente.
- Manter o modelo configurado como seleção padrão e preservar o fallback atual quando o usuário não fizer uma escolha explícita.

## Detalhe interno da pauta (`/monthly-plan/:planId`)
- Reorganizar o cabeçalho com Ver projeto/Escolher projeto, título editável, chips de Estratégia IA, métricas/contas, Briefing + Brain e modelo utilizado.
- Manter Descrição e Objetivos editáveis e melhorar sua hierarquia em duas colunas responsivas.
- Apresentar “Ideias de posts” com contagem e cartões mais claros para status, título, canal, formato, Gancho, Público-alvo e “Por quê”.
- Preservar integralmente: novo tópico, aprovar todos, aprovar/descartar, regenerar com instrução, desfazer, remover, edição inline, feedback do cliente e regras de bloqueio/completude.
- Reorganizar a barra fixa sem remover seus estados e ações: Voltar, Descartar pauta, Excluir definitivamente, Copiar link quando disponível, Enviar ao cliente e Enviar para produção quando aplicável.
- Não alterar a página pública de aprovação do cliente (`/pauta/:planId`) nem qualquer outra tela.

## Detalhes técnicos
- Concentrar as mudanças nos componentes de Pautas, volumetria, lista, chips de contexto e assistente, além das duas rotas internas para metadados próprios.
- Estender o contrato de geração com uma escolha opcional e validada de provedor/modelo; o servidor aceitará apenas opções realmente configuradas para aquele workspace.
- Não criar tabelas, migrations ou mudar RLS/RBAC; esta entrega não precisa alterar a verificação de estruturas do instalador.
- Adicionar testes para a lista segura de modelos, validação da escolha, preservação do padrão/fallback e invariantes das ações de Pautas.
- Validar tipos, testes focados, build, estados responsivos possíveis no preview e ausência de erros recentes.
- Finalizar pelo fluxo MASTER-first: regenerar o delta, sincronizar uma nova versão em `delta_version.txt` e `MASTER_RELEASE_VERSION`, executar `bun run master:check` e os dois guardiões de instalação. Publicação e propagação ficam pendentes até autorização explícita.

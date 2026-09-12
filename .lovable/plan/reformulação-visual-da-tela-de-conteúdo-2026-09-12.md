# Reformulação visual da tela de Conteúdo

## Objetivo
Reorganizar exclusivamente a apresentação da rota interna `/content`, seguindo a referência enviada e o design system do Unitos, sem alterar dados, permissões, regras de negócio ou outras telas.

## Implementação

### 1. Cabeçalho e barra de controles
- Manter o título, seletor de pipeline, configurações e menu completo de “Novo conteúdo” (criação manual e geração por IA).
- Refinar a hierarquia da barra com Filtros, Selecionar, contador e alternador Kanban/Lista.
- Preservar todos os filtros atuais, seleção em massa, ações em lote, lixeira e gestão de pipelines/colunas.
- Manter o banner de legendas pendentes, incluindo atualização em tempo real e ação “Gerar legendas pendentes”.

### 2. Kanban
- Reestilizar as colunas com faixa superior, indicador, contagem, ordenação e menu, sem tocar no arrastar e soltar.
- Aplicar às etapas canônicas solicitadas: Ideia (cinza), Produção (azul), Design (roxo), Revisão (amarelo), Aprovado (verde) e Agendado (índigo), usando tokens semânticos do tema.
- Preservar criação rápida/completa, renomear, recolorir, excluir, SLA, estados vazios e “Adicionar coluna”.
- Ajustar o texto visual para “Nova peça”, sem mudar a operação existente.

### 3. Cards e visão em lista
- Reorganizar cada card com chips reais de plataforma e formato, título, legenda em duas linhas, área de mídia/IA e rodapé com responsável e data/hora.
- Não exibir o chip “Normal”, conforme definido, pois não existe esse campo no modelo atual.
- Preservar “Legenda falhou”, “Definir canal/formato”, prioridade, SLA, tags, anexos e demais indicadores existentes.
- Manter a visão em lista e sua multisseleção totalmente funcionais.

### 4. Editor lateral
- Reorganizar o painel em seções claras para título/IA, etapa, responsável, projeto, aprovação, destinos, formato, mídias, legenda, briefings/roteiro e agenda.
- Preservar upload por clique e arrastar/soltar, conversão automática para Carrossel, autosave da legenda, geração/regeneração por IA, agendamento, lembrete e data de criação.
- Manter também as funções atuais não destacadas na referência: prioridade, tags, visibilidade no portal, links de aprovação, briefing visual, histórico, aprovar e agendar.
- Manter o rodapé fixo com Excluir, Refazer e Salvar, incluindo confirmações, estados de carregamento e mensagens existentes.

### 5. Escopo e qualidade
- Alterar somente os arquivos de apresentação e a rota interna de Conteúdo; nenhuma mudança de banco, RLS/RBAC, funções do servidor ou portal público.
- Adicionar metadados próprios à rota `/content`.
- Criar testes de invariantes para controles, campos e ações preservadas.
- Validar tipos, testes focados, build e ausência de regressões no preview quando a sessão autenticada estiver disponível.

## MASTER-first
- Regenerar o delta do MASTER, atualizar a versão e o SHA sincronizados e confirmar que não há nova estrutura para acrescentar à verificação de instalação.
- Executar `master:check` e os dois testes guardiões de instalação.
- Não publicar nem propagar para instalações sem autorização explícita.

## Arquivos previstos
- `src/routes/_authenticated/content.tsx`
- `src/components/content/content-toolbar.tsx`
- `src/components/content/copy-queue-bar.tsx`
- `src/components/content/content-board.tsx`
- `src/components/content/content-list.tsx` (somente se necessário para consistência visual)
- `src/components/content/task-dialog.tsx`
- `src/components/content/stage-colors.ts` e/ou `src/styles.css` para tokens semânticos
- testes focados da apresentação de Conteúdo
- arquivos de sincronização da versão MASTER

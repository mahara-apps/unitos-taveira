# Prévia de carrossel navegável + Opções avançadas por destino (canais)

Três frentes, na ordem de entrega. O backend de carrossel (Instagram e Facebook) já está implementado e validado nesta rodada — este plano trata da camada de experiência e das opções por canal.

## 1. Prévia de carrossel navegável (rápido)

Hoje a prévia mostra apenas a primeira mídia e uns "dots" decorativos.

- `PostPreview` passa a receber a lista completa de mídias (não só a capa) quando o formato é Carrossel.
- Navegação: arrastar para o lado (swipe/drag do mouse e do toque), setas laterais no hover, clique nos dots e teclado (setas esquerda/direita).
- Indicador "3/5" e os dots refletindo o slide atual, na mesma ordem em que a peça vai publicar.
- A ordem exibida é exatamente a ordem das mídias anexadas (que é a ordem enviada à Meta). Reordenar mídias continua sendo feito na lista "Mídia da publicação"; o slide atual acompanha.
- Nenhuma mudança de dados: componente puramente visual, usado pelo composer e pelo detalhe da publicação no calendário.

## 2. Destinos por canal (reorganização da seleção)

A seleção atual mistura conta e formato em uma lista única dentro de um popover.

- A área de Destinos passa a ter uma fileira de canais (Instagram, Instagram Stories, Reels, Facebook, Facebook Stories, Facebook Reels, e os canais ainda não conectados em cinza com aviso), no espírito do exemplo enviado.
- Clicar em um canal adiciona/remove o destino; canais sem conta vinculada aparecem desabilitados com o motivo ("nenhuma conta vinculada a este cliente") e atalho para Conexões.
- Formatos incompatíveis com a mídia anexada continuam bloqueados com a explicação atual (ex.: Carrossel exige 2+ imagens; Reels exige vídeo).
- Cada destino selecionado vira um "chip" com conta, formato, estado (Pronto / Bloqueado) e um botão de engrenagem que abre as opções avançadas daquele destino.
- Regras de negócio, escopo por cliente, RBAC/RLS e o formato salvo em `post_placements` não mudam — só a apresentação e o caminho de seleção.

## 3. Opções avançadas por destino (aparecem conforme o destino)

Um painel por destino, exibindo somente o que aquele canal/formato aceita. Divisão honesta entre o que a API da Meta publica de fato e o que é apenas anotação operacional:

Publicáveis via API (efeito real na publicação):
- Primeiro comentário — Instagram Feed/Carrossel/Reels e Facebook Feed (postado logo após a publicação).
- Localização — Instagram Feed/Carrossel/Reels (já existe hoje, passa para o painel do destino).
- Marcação de pessoas — Instagram Feed/Carrossel (tags por usuário; no carrossel, por slide).
- Colaborador — Instagram Feed/Carrossel/Reels (convite de coautoria).
- Compartilhar Reels no Feed — Instagram Reels (já suportado internamente, passa a ser opção visível).
- Desativar comentários — Instagram Feed/Carrossel/Reels.
- Configuração de áudio (nome da faixa/áudio original) — Instagram Reels.

Anotação operacional (fica salvo na peça e visível para a equipe, sem efeito na API):
- Parceria paga, Instagram Shop / marcação de produto, Texto alternativo, Menção em Stories.
  Estes ficam marcados como "não aplicado automaticamente" com nota curta, para ninguém achar que foi enviado.

Comportamento:
- Nada é obrigatório; sem preenchimento o comportamento atual continua idêntico.
- Cada opção é validada no servidor no momento da publicação; opção inválida gera aviso em português e não derruba a publicação principal (ex.: primeiro comentário falha → post publicado + aviso registrado).
- Opções aparecem também no detalhe da publicação no calendário (leitura), para conferência antes de aprovar.

## Detalhes técnicos

- Prévia: novo estado de slide em `src/components/social/post-preview.tsx` (drag por pointer events, sem dependência nova), e o composer/detalhe passam a lista de mídias em vez de apenas a capa.
- Destinos: reescrita apresentacional da seção Destinos em `src/components/calendar/schedule-wizard/index.tsx`, reutilizando `FORMATS_BY_CHANNEL`, `isFormatCompatibleWithMedia` e `togglePair` já existentes.
- Persistência das opções: `post_placements.copy_override` já é `jsonb` — as opções entram como um bloco `options` dentro dele, por destino. Sem migration.
- Fila de publicação: `social_posts.media`/campos existentes seguem inalterados; as opções são lidas do placement no momento do disparo em `src/lib/meta/publishing.server.ts` (primeiro comentário, tags, colaborador, comentários desativados, áudio) e no worker `src/routes/api/public/meta/publish-scheduled.ts`.
- Sem alteração de RBAC, RLS, auth ou schema. Fuso oficial `America/Sao_Paulo` mantido. Nenhuma publicação automática nova.
- Testes: unitários para navegação do carrossel na prévia, matriz de opções por canal/formato e aplicação das opções na publicação (incluindo falha isolada do primeiro comentário).

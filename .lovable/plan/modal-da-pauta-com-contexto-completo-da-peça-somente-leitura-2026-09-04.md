# Modal da pauta com contexto completo da peça (somente leitura)

Hoje o modal aberto ao clicar num item de Pautas mostra apenas capa, canal, formato, estado, agendamento, dono, tarefas e observações. Vamos enriquecê-lo com todo o contexto necessário para produzir a peça, sem sair da tela do projeto e sem permitir edição (edição continua em Conteúdo).

## O que o modal passará a mostrar

Organizado em blocos, cada campo aparece só quando existe:

1. **Cabeçalho** — título, estado atual, status da pauta e decisão do cliente.
2. **Publicação** — data/hora agendada (fuso America/Sao_Paulo), status do agendamento, rede(s) social(is), formato do conteúdo e o "local de postagem": contas/páginas conectadas do cliente (placements), com marcação do principal.
3. **Briefing** — ângulo, racional e público-alvo vindos da pauta; briefing interno, briefing do cliente e brief de design vindos da peça.
4. **Legenda / copy** — texto da legenda, roteiro (quando houver) e hashtags/tags.
5. **Referências** — links e mídias de referência da peça, com miniaturas quando forem imagens.
6. **Operação** — prioridade, dono (responsável da tarefa de produção), prazo, tarefas de produção vinculadas e comentários do item (como já existe hoje).
7. **Comentário do cliente** — quando a pauta teve devolutiva.

Blocos vazios são omitidos; texto longo aparece com rolagem dentro do modal.

## Comportamento

- Continua modal (não navega): clicar na linha abre, ESC fecha.
- Carregamento com skeleton enquanto os dados da peça chegam; item sem peça criada mostra somente o briefing da pauta e o aviso de que a produção ainda não começou.
- Ações do rodapé seguem como hoje: "Ver na pauta" e "Abrir peça em Conteúdo".
- Nenhum campo editável neste modal, exceto os controles que já existem (dono e status da tarefa de produção).

## Detalhes técnicos

- Nova função server-side `getPautaDetailFn` em `src/lib/projects.functions.ts`, com `requireSupabaseAuth`, validando `brandId` + (`postId` ou `topicId`) e escopo do projeto:
  - `posts`: `title, format, channels, scheduled_at, schedule_status, priority, tags, copy, script, internal_briefing, client_briefing, design_brief, references, reference_media, cover_url, review_status, stage, published_at`.
  - `monthly_plan_topics`: `topic_title, angle, rationale, target_audience, status, client_status, client_comment`.
  - `post_placements` + nome/handle da conexão social correspondente para o "local de postagem".
- `src/components/projects/pauta-detail-modal.tsx`: consumir a nova função via TanStack Query (chave `["pauta-detail", brandId, postId ?? topicId]`, `staleTime` curto), renderizar os blocos acima e manter dono/status/tarefas/comentários atuais.
- Datas formatadas por `src/lib/timezone.ts`; rótulos de canal/formato pelos utilitários já usados (`CHANNEL_LABELS`, `contentFormatLabel`).
- Sem migração, sem mudança de RLS, sem alteração de regras de negócio ou de outras telas.

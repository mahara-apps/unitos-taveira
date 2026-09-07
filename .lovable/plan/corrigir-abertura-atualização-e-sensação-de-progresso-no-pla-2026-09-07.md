# Corrigir abertura, atualização e sensação de progresso no Plano de Mídia

## O que está acontecendo

1. **Voltar ao plano abre o painel do cliente (Visão geral), não o plano.**
   O guard do painel do cliente normaliza a aba antes de qualquer coisa. Ao entrar em
   `/customers/<cliente>/media-plan` a aba vem vazia, o guard considera isso "fora do padrão"
   e redireciona para o painel do cliente — descartando o endereço do plano. Vale para clique
   na lista de Mídia paga, refresh da página e link direto.

2. **Depois do plano pronto, atualizar a tela deixa a página em branco.**
   A tela do plano não tem tratamento de erro/carregamento próprio: qualquer falha na leitura
   (ou o redirecionamento acima chegando com endereço inconsistente) resulta em tela vazia sem
   mensagem e sem botão de voltar.

3. **"Montando o plano..." não passa sensação de atividade.**
   Hoje só o texto do botão muda. Não há progresso, tempo decorrido nem aviso — o usuário
   acha que travou, tenta atualizar a página ou fechar, e perde a entrevista.

## O que vamos entregar

**Abrir o plano sempre funciona**
- A normalização da aba passa a valer somente quando o usuário está de fato no painel do
  cliente; sub-páginas (Plano de mídia) deixam de ser redirecionadas.
- O endereço continua guardando qual plano está aberto, então atualizar a página reabre o
  mesmo plano; sem plano na URL, abre o mais recente.
- Endereços antigos/estranhos (aba inválida, parâmetro inesperado) são tolerados em vez de
  quebrar a tela.

**Nunca mais tela branca**
- A tela do plano ganha estado de carregamento e uma tela de erro amigável, com o motivo em
  português e botões "Tentar novamente" e "Voltar para Mídia paga".
- Quando o plano não existe mais (excluído), aparece um aviso claro em vez de vazio.

**Sensação real de trabalho em andamento**
- Ao enviar a entrevista, aparece uma tela de progresso dentro do modal: etapas em sequência
  ("lendo o briefing", "escolhendo campanhas", "dividindo o orçamento", "escrevendo criativos"),
  barra animada e tempo decorrido.
- Aviso visível: "Isso leva de 1 a 3 minutos. Mantenha esta janela aberta."
- Enquanto gera: fechar, voltar e atualizar ficam bloqueados (com confirmação do navegador),
  e as respostas ficam guardadas para reaproveitar se algo falhar.
- Se falhar, a mensagem explica o motivo e oferece "Tentar de novo" sem refazer a entrevista.

Testado no ambiente da Taveira: a Taveira precisa estar na versão publicada mais recente para
receber esta correção.

## Detalhes técnicos

- `src/routes/_authenticated/customers.$customerId.tsx`: no `beforeLoad`, aplicar o redirect de
  normalização de aba apenas quando `location.pathname` é exatamente
  `/customers/<id>` (rota-pai); preservar `search` restante. Mantém o guard de UUID e o
  `Outlet` para sub-rotas.
- `src/routes/_authenticated/customers.$customerId.media-plan.tsx`: `validateSearch` com
  `.catch()` por campo e no objeto; adicionar `errorComponent`, `notFoundComponent` e
  `pendingComponent` na rota; estado vazio quando `planId` da URL não existe mais; manter
  `planId` na URL ao selecionar plano (já existe) e sincronizar após criação.
- `src/components/media-plans/create-media-plan-dialog.tsx`: novo estágio `generating` que
  substitui o conteúdo do modal pelo painel de progresso; `busy` bloqueia `onOpenChange`
  (já bloqueia) e também "Rever respostas"; guardar `InterviewResult` em estado para retry.
- `src/components/media-plans/media-plan-interview.tsx` / novo
  `src/components/media-plans/plan-generation-progress.tsx`: etapas simuladas por tempo
  (sem tocar no backend), contador de elapsed, `useUnsavedGuard` ativo durante a geração.
- Nenhuma mudança de banco, RLS, server function ou prompt de IA.
- Testes: `tests/customer-tabs.test.ts` (sub-rota não é redirecionada) e teste do
  progresso/retry do modal.
- MASTER-first: sem migração nova; regenerar o pacote (`build_delta.py`), subir
  `delta_version.txt` + `MASTER_RELEASE_VERSION` para `1.2.6`, rodar `bun run master:check`,
  publicar o MASTER e autorizar "Atualizar" na Taveira.

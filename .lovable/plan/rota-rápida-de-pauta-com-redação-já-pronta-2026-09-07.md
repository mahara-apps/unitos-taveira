# Rota rápida de pauta com redação já pronta

## O que existe hoje (verificado)

O caminho atual da pauta tem seis paradas:

```text
Nova pauta (título + projeto)
  -> Assistente "Gerar com IA" (3 passos: escopo, canais, volumetria por formato)
  -> Temas gerados (revisão item a item, regeneração)
  -> Aprovação interna dos temas
  -> Aprovação do cliente (quando a política daquele cliente exige)
  -> Peças entram em Produção e a IA escreve a legenda de cada uma
```

A redação só nasce na última parada, quando as peças são criadas no quadro de
Produção. Não existe hoje nenhum atalho que entregue tema + redação de uma vez.

## O que será criado

Dois atalhos, ambos na tela de Pautas do cliente, ao lado de "Nova pauta" e
"Gerar com IA":

### 1. Peça expressa

Uma tela só, três campos: a ideia em uma linha, canal/formato e projeto.
A IA devolve título e legenda prontos em seguida, com prévia editável antes de
salvar. A peça entra em Produção já escrita, no primeiro estágio.

### 2. Mini-pauta expressa

Uma tela só: projeto, canal, quantas peças (com o disponível do mês visível) e
um tema geral opcional. Em uma única ação a IA gera os temas E as legendas de
todas as peças. Enquanto roda, a tela mostra progresso real ("2 de 5 escritas"),
bloqueia sair sem aviso e permite tentar de novo se alguma falhar — mesmo padrão
já usado no plano de mídia.

### Regras preservadas em ambos

- Política de aprovação do cliente respeitada: se aquele cliente aprova pauta
  e/ou conteúdo, a peça nasce como proposta aguardando aprovação, nunca
  publicada nem agendada de verdade.
- Aprovação interna continua existindo — o atalho encurta o caminho, não remove
  etapa de decisão.
- Limite mensal contratado sempre respeitado: se o pedido estoura a volumetria,
  o atalho avisa e oferece o pedido de excedente que já existe.
- Projeto continua obrigatório (é a execução da pauta) e as tarefas de produção
  continuam sendo criadas automaticamente.
- Permissões por papel e por cliente inalteradas: quem não vê o cliente não usa
  o atalho.

## Detalhes técnicos

- Reuso, sem fluxo paralelo: `runPlanGeneration` (temas),
  `materializePlanToKanban` (peças + tarefas + projeto) e
  `generatePostsContentSequential` (redação) já formam a cadeia completa; o
  atalho apenas os encadeia em uma só chamada.
- Novas server functions em `src/lib/monthly-plans.functions.ts`:
  `quickPlanFn` (mini-pauta: cria plano + gera temas + aprova internamente +
  materializa) e `quickPostFn` (peça avulsa: `createPost` + cadeia de copy).
  Ambas autenticadas, escrevendo com o client do usuário (RLS).
- Volumetria e excedente via `getPlanVolumetry` / `plan-overage.server.ts`;
  política via `client-policy.server.ts` (`approval_policy`, `scope_policy`) —
  nunca lendo as colunas soltas.
- Progresso e estados: `monthly_plans.status` + `posts.ai_phase`
  (`copy_running` / `copy_ready` / `copy_failed_*`) já existentes, expostos por
  polling; retomada usa `resumePendingPostsFn`.
- UI nova: `src/components/monthly-plan/quick-pauta-dialog.tsx` e
  `quick-post-dialog.tsx`, acionadas de `monthly-plan.index.tsx` e
  `customers.$customerId.pauta.tsx`. Nada muda no assistente atual.
- Testes: cobertura de política de aprovação, estouro de volumetria, projeto
  obrigatório, idempotência (não duplicar peça/tarefa) e falha de redação sem
  legenda genérica.
- Sem mudança de schema prevista. Fechamento MASTER-first obrigatório:
  regenerar o pacote, subir `delta_version.txt` e `MASTER_RELEASE_VERSION`
  para 1.3.2 e rodar `bun run master:check` antes de publicar.

## Fora de escopo

Não altera o assistente de 3 passos, o Kanban, o calendário, o portal do
cliente nem as regras de agendamento/publicação.

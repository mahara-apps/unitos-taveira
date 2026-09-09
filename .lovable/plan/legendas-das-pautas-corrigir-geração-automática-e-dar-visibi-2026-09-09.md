# Legendas das pautas: corrigir geração automática e dar visibilidade

## O que está acontecendo (verificado)

Sim, existe um problema real e ele é do sistema, não da Taveira.

Quando você aprova os conteúdos, as peças são criadas na hora e a escrita das legendas é disparada
"em segundo plano", sem nenhum registro de fila. Se essa execução em segundo plano for interrompida
(tempo do servidor, erro do provedor de IA, muitas peças de uma vez), a legenda simplesmente não
acontece — e **nada** avisa você, porque:

- não existe nenhuma rotina automática que retome legendas pendentes ou que tenham falhado
  (conferi os 18 agendamentos ativos: não há nenhum para isso);
- a peça guarda apenas um estado interno, sem o motivo da falha;
- na tela de Conteúdo o card não mostra "legenda pendente" nem "falhou" — só ao abrir a peça
  aparece o botão "Gerar legenda", uma por uma;
- a única forma de retomar em lote já existe pronta no servidor, mas não está ligada a nenhum
  botão nem a nenhum agendamento.

O acúmulo confirma o diagnóstico na base do ambiente principal: **81 peças sem legenda paradas em
"ideia"**, 26 com falha definitiva, 2 travadas "em execução" desde 03/09 e 1 falha reaproveitável.

## O que será feito

1. **Retomada automática**: novo agendamento que, a cada minuto, procura peças sem legenda
   (pendentes, falhas reaproveitáveis e travas órfãs) e conclui a escrita, em ritmo controlado para
   não estourar cota do provedor. O motor já existe; falta ligá-lo.
2. **Guardar o motivo da falha** na peça, para a tela poder explicar em português (ex.: "cota da IA
   esgotada", "chave da IA inválida") em vez de deixar em branco.
3. **Visibilidade na tela de Conteúdo**:
   - selo no card: "Legenda em produção", "Legenda pendente" ou "Legenda falhou";
   - faixa no topo: "N peças sem legenda" com botão **"Gerar legendas pendentes"** (usa a rotina
     em lote já existente) e atualização automática enquanto estiver rodando.
4. **Aviso no momento da aprovação**: ao aprovar a pauta, a mensagem passa a dizer que as legendas
   estão sendo escritas e que a tela se atualiza sozinha — sem sensação de travamento.
5. **Recuperar o passado**: as peças antigas sem legenda (inclusive as travadas) voltam para a fila
   automaticamente assim que a retomada entrar no ar; as com falha definitiva ficam com o motivo
   visível e o botão de tentar de novo.
6. **MASTER-first**: agendamento e mudanças entram no pacote MASTER (nova versão), com verificação,
   para propagar à Taveira e às demais instalações.

## Detalhes técnicos

- Agendamento `post-content-resume` (`* * * * *`) chamando
  `/api/public/hooks/resume-post-content` com `x-cron-secret`, adicionado a
  `supabase/baseline-snapshot/002_bootstrap_cron.sql`, `supabase/install/020_cron.sql` e a uma
  migration idempotente (mesmo padrão dos jobs `briefing-import-*`).
- `src/lib/post-agents.server.ts`: gravar `ai_phase_error` (texto curto/classificação) junto de
  `AI_PHASE.retryable|permanent`; manter `RESUMABLE_AI_PHASES` e a reclamação de `copy_running`
  após `STALE_LOCK_MS`.
- Migration: coluna `posts.ai_phase_error text` (nullable) — sem impacto em RLS/grants existentes.
- `src/lib/content.functions.ts`: incluir `ai_phase`/`ai_phase_error` no `listBoard` (já traz
  `ai_phase`) e expor contagem de pendentes; `resumePendingPostsFn` já existe e passa a ser usada
  pelo botão em lote (mantendo RBAC atual).
- `src/routes/_authenticated/content.tsx` + `src/components/content/*`: selo por card, faixa de
  pendentes com botão e `refetchInterval` curto enquanto houver peça em produção.
- `materializePlanToKanban` continua idempotente e mantém `waitUntil` como caminho rápido; a fila
  passa a ser a rede de segurança.
- Encerramento: Prettier, `tsgo --noEmit`, testes focados (fila/estados de legenda), build,
  regenerar delta, subir `delta_version.txt` + `MASTER_RELEASE_VERSION` (1.3.15 → 1.3.16),
  cobrir a coluna nova em `verify-installation.sql` e rodar `bun run master:check`.

## Fora do escopo

- Trocar provedor de IA ou o texto dos prompts.
- Alterar aprovação do cliente, portal, permissões ou o fluxo da pauta.

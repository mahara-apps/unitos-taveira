# Timesheet: refazer contagem de tempo (segundos, minutos, horas)

## O que está errado hoje (confirmado no banco e no código)

- O banco só guarda **minutos inteiros** por apontamento, com arredondamento e piso de 1 minuto (`start_timer` e `stop_timer` gravam `GREATEST(1, ROUND(segundos/60))`). Por isso 3 segundos viram `00:01:00` e cada pausa/retomada infla o total.
- O relógio na tela soma `minutos × 60`, então os segundos desaparecem no instante em que você pausa ou para — o contador "volta" para um valor arredondado.
- "Pausado" só existe no `localStorage` do navegador (`unitos.timesheet.paused.<taskId>`). Em outro navegador, aba nova ou após limpar o cache, uma tarefa pausada aparece como "Parado", e Pausar e Parar viram a mesma coisa.
- `Parar` fica habilitado/desabilitado por esse mesmo estado local, o que explica os botões parecerem "sem efeito".
- O total da tarefa (`tasks.total_minutes`) é a soma dos minutos já arredondados, propagando o erro para os relatórios de projeto.

## O que vai mudar

1. **Precisão em segundos no banco**
   - Nova coluna `seconds` em `task_time_entries` (fonte da verdade), preenchida a partir de `ended_at - started_at`, sem piso artificial.
   - `minutes` continua existindo e passa a ser derivado dos segundos, para não quebrar nada que já lê esse campo (painel de jobs, agency ops).
   - Backfill dos registros existentes: `seconds = minutes × 60` quando não há como recalcular; quando há `started_at`/`ended_at`, recalcula pela diferença real.
   - `refresh_task_total_minutes` passa a somar segundos e arredondar **uma única vez** no total.

2. **Estado real de Iniciar / Pausar / Parar**
   - Nova coluna `ended_reason` (`pause` | `stop` | `auto`) no apontamento, gravada por quem encerra o segmento.
   - O estado do timer passa a vir do servidor: `em execução` (existe segmento aberto), `pausado` (último segmento encerrado por pausa), `parado` (nunca iniciado ou último segmento encerrado por parada).
   - O `localStorage` deixa de ser fonte de verdade — sai do fluxo.
   - Funções do banco: `stop_timer(_entry_id, _reason)`, mantendo compatibilidade com a chamada antiga; `start_timer` continua encerrando automaticamente o timer aberto do usuário em outra tarefa (motivo `auto`).

3. **Relógio na tela**
   - Total exibido = soma dos segundos salvos + segundos corridos do segmento aberto, atualizando a cada 1s em `HH:MM:SS`.
   - Ao pausar, o relógio congela exatamente no valor real (sem salto de arredondamento); ao retomar, continua de onde parou; ao parar, mostra o total consolidado.
   - Botões: `Iniciar`/`Retomar` (quando parado/pausado), `Pausar` (quando rodando), `Parar` (habilitado quando rodando ou pausado). Rótulo `Trocar` quando há timer rodando em outra tarefa.
   - Histórico passa a mostrar `HH:MM:SS` por apontamento, e a etiqueta de origem (Timer/Manual/Retrabalho) se mantém.

4. **Apontamento manual**
   - Continua aceitando `HH:MM` e minutos puros; passa a aceitar também `HH:MM:SS`, gravando segundos exatos.

## Detalhes técnicos

- Migração: `ALTER TABLE public.task_time_entries ADD COLUMN seconds integer`, `ADD COLUMN ended_reason text`, backfill, e atualização de `start_timer`, `stop_timer` e `refresh_task_total_minutes` (todas `SECURITY DEFINER` com `search_path` já fixado). Sem mudança de RLS ou grants — a tabela e as políticas atuais permanecem.
- `src/lib/timesheet.functions.ts`: expõe `seconds` e `ended_reason` no tipo `TimeEntry`; `getMyActiveTimerFn` passa a retornar também o último estado da tarefa (para diferenciar pausado de parado); `stopTimerFn` recebe `reason`; helpers `formatSeconds`/`parseDuration`.
- `src/components/tasks/task-timer-widget.tsx`: reescrito em cima do estado do servidor, removendo `pausedKey`/`readPaused`/`writePaused`; mantém atualização otimista para o clique não parecer travado.
- `src/components/projects/task-timesheet-sheet.tsx`: histórico e retrabalho em segundos, parser de duração compartilhado.
- `jobs-panel.tsx` e `agency-ops.functions.ts` continuam lendo minutos (agora corretos), sem alteração de contrato.

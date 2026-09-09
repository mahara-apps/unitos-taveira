# Por que a atualização da Taveira parou em "build em andamento (BLOCKED)"

## O que aconteceu (confirmado agora)

A atualização enviou o código para o repositório da Taveira com sucesso e pediu
a publicação. A hospedagem **recusou** essa publicação e devolveu o motivo
literal:

> "REST API deployments are not allowed in production. Only Git deployments are
> allowed."

Ou seja: a conta de hospedagem passou a aceitar publicações em produção somente
quando disparadas pelo próprio Git — e o nosso pedido é feito pela API. Duas
publicações ficaram nesse estado hoje (16:49), enquanto as de 14:43 ainda
passaram: a regra foi ligada nesse intervalo.

Piora porque o projeto de hospedagem da Taveira está ligado ao repositório em
modo "sem fonte" (`sourceless`): o repositório aparece vinculado, mas os pushes
não disparam publicação. Resultado: a API é barrada e o Git não dispara —
nenhum caminho publica.

E o nosso lado trata esse "recusado" como "ainda buildando": a operação fica
`running` para sempre, o vigia a retoma de minuto em minuto e a tela mostra
50% eternamente. A operação da Taveira está aberta desde 16:42 nesse laço.

Nada foi perdido: o código está no repositório, o banco já foi conferido, e a
Taveira continua no ar na versão anterior (1.3.21 fixada).

## O que será feito

1. **Destravar a Taveira agora**: religar corretamente o repositório ao projeto
   de hospedagem (sai do modo "sem fonte"), disparar a publicação pelo Git e
   acompanhar até concluir; a operação presa é encerrada com resultado real.
2. **Nunca mais ficar em laço**: publicação recusada passa a ser um resultado
   final, com o motivo em português na tela, em vez de "build em andamento".
3. **Caminho alternativo automático**: quando a hospedagem recusar a publicação
   por API, o sistema liga a publicação automática por Git e força o disparo
   pelo push — o mesmo caminho que já existe para quando a cota diária estoura.
4. **Aviso antes de começar**: a verificação prévia da instalação passa a
   checar se o repositório está ligado de verdade e se a publicação por API é
   permitida; se não estiver, a atualização já avisa o que corrigir em vez de
   travar no meio.
5. **Tempo máximo de espera**: qualquer publicação sem conclusão em ~20 minutos
   encerra com mensagem clara e botão para retomar, em vez de rodar sem fim.

## Detalhes técnicos

- `src/lib/installation/automation.server.ts`
  - `deploymentState` passa a devolver também `readyStateReason` e a tratar
    `BLOCKED`/`alwaysRefuseToBuild` como terminal.
  - No laço de build: `BLOCKED` → não retorna `PENDING`; entra no mesmo ramo de
    fallback usado por `quotaExceeded`/`gitSourceUnavailable`
    (`setAutoDeploy(true)` + `code.nudgeDeploy(...)`), fixando
    `pinned_release`/`pinned_commit_sha` e finalizando com aviso.
  - `deployLatestCode` classifica a resposta com `readyStateReason` contendo
    "not allowed in production" como `gitSourceUnavailable`.
  - Limite absoluto por operação (`startedAt + 20min`) → `FAIL` com motivo,
    em vez de `PENDING` infinito.
- Preflight/readiness (`preflight-contract.ts` / checagem de deploy): novo item
  que reprova com BLOCKED quando `project.link.sourceless === true` ou não há
  repositório ligado, com texto acionável.
- `resume-worker.server.ts`: não retomar operação cujo deployment já esteja em
  estado terminal recusado; encerrar com `finalizeOperation`.
- Correção operacional da Taveira (fora do código): re-link do repositório via
  API do projeto e novo commit de disparo; sincronizar versão com
  `syncInstallationVersionFn`.
- Testes: `tests/installation-deploy-quota.unit.test.ts` ganha caso BLOCKED por
  política de produção; novo caso de timeout absoluto.
- Fechamento MASTER-first: regenerar o pacote de deltas, atualizar
  `delta_version.txt` + `MASTER_RELEASE_VERSION` para 1.3.27, cobrir nada novo
  no banco (não há migração) e rodar `bun run master:check`, typecheck e build.

## Fora de escopo

Não altera RBAC/RLS, dados da Taveira, integrações Meta/WhatsApp nem o fluxo de
provisionamento inicial.

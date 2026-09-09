# Legendas por evento, sem rotina rodando o dia todo

Sua preocupação é correta: uma checagem por minuto significa 1.440 verificações por dia, todos os dias, mesmo quando não há nenhuma legenda para escrever. Em plano gratuito isso disputa recurso com todo o resto do sistema.

A proposta é trocar "checar sempre" por "avisar quando tiver trabalho".

## Como fica

1. **Disparo no momento certo.** Quando uma peça entra na fila de legenda (aprovação da pauta, criação expressa, ou uma falha marcada para nova tentativa), o próprio banco avisa o sistema na hora. A legenda começa a ser escrita em segundos, sem nenhuma rotina periódica envolvida.
2. **Rede de segurança que se desliga sozinha.** Se um aviso se perder (queda de rede, deploy no meio do caminho), uma varredura de retomada é agendada — mas só enquanto existirem peças pendentes. Quando a fila esvazia, ela se remove automaticamente e o banco volta a ficar em silêncio. Zero checagem em dia sem trabalho.
3. **Tela atualiza sozinha.** A faixa de status e os selos de legenda passam a acompanhar a fila em tempo real, então você vê "escrevendo…" e depois a legenda pronta sem precisar recarregar.
4. **Botão de retomar continua.** Se algo ficar preso, dá para reprocessar manualmente na tela de Conteúdo, como hoje.

Resultado: legenda aparece em segundos no caminho normal, e o custo no banco passa a ser proporcional ao uso — não ao tempo.

## Alternativas, se preferir

- **Só o disparo por evento**, sem rede de segurança: mais econômico ainda, mas se um aviso falhar a peça fica esperando até alguém clicar em retomar.
- **Rede de segurança a cada 15 minutos, sempre ativa**: 96 execuções por dia em vez de 1.440, com atraso máximo de 15 minutos quando o aviso falha. Mais simples, porém segue gastando algo em dias parados.

A recomendação é o modelo principal acima (evento + rede que se desliga).

## Detalhes técnicos

- Nova função e trigger em `posts`: ao entrar em `idea`/`copy_failed_retryable` (ou ao liberar lock órfão), chama `net.http_post` para `/api/public/hooks/resume-post-content` com `x-cron-secret` do Vault — o mesmo padrão de autenticação já usado pelos hooks.
- Debounce: uma tabela leve de controle (ou coluna de marca de disparo) evita rajada de chamadas quando várias peças são aprovadas em lote; um disparo cobre o lote, e o endpoint já processa em série com `limit`.
- Substitui o job `post-content-resume` `* * * * *` por um job sob demanda `post-content-drain` (`*/5 * * * *`) criado pelo trigger e removido via `cron.unschedule` pelo próprio endpoint quando não sobra nenhuma peça pendente nem retry futuro.
- `resumePendingPostContent` passa a retornar se a fila esvaziou, para o endpoint decidir o unschedule.
- Frontend: assinatura Realtime em `posts` (filtrada por cliente) atualizando `copy-queue-bar.tsx` e os selos em `content-board.tsx`, com `removeChannel` no cleanup.
- Instalação/MASTER: `020_cron.sql`, `002_bootstrap_cron.sql` e o baseline deixam de agendar o job por minuto; a verificação passa a checar a função/trigger de disparo em vez do job fixo. Migration idempotente, `build_delta.py`, `delta_version.txt` + `MASTER_RELEASE_VERSION` (1.3.18) sincronizados, `bun run master:check` verde, depois publicação e autorização nas instalações.
- RBAC/RLS, papéis e rotas existentes permanecem intactos.

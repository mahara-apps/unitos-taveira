# Padrão técnico de integrações externas — Unitos

Documento normativo. Vale para TODA integração com API de terceiros (Meta,
Google, WhatsApp/Evolution, provedores de IA, e-mail, pagamentos, etc.).

Referência de implementação viva: `src/lib/meta/graph-budget.ts` (módulo puro de
limites, cache, dedupe, concorrência e telemetria), `src/lib/meta/scan-cache.server.ts`
(cache compartilhado por token) e `src/lib/meta/refresh-policy.ts` (política
full × incremental). Novas integrações devem replicar esse formato, não inventar
outro.

Regra de ouro: **toda API externa é recurso caro e instável.** Chamada sem
budget, timeout, cache, dedupe, limite de concorrência, política de retry,
tratamento de rate limit e telemetria é considerada implementação incompleta e
não deve ser aceita em revisão.

---

## 0. Arquitetura obrigatória por integração

Cada integração vive em `src/lib/<integracao>/` com esta separação:

```text
src/lib/<integracao>/
  budget.ts             módulo PURO: limites, mapLimit, cache, telemetria
  policy.ts             módulo PURO: decisões (full vs incremental, TTLs)
  provider.server.ts    ÚNICO ponto de saída HTTP (server-only)
  cache.server.ts       cache compartilhado + dedupe por chave de credencial
  <recurso>.functions.ts  createServerFn (RBAC/guards) — nunca fetch direto
```

Invariantes:

1. **Um único gargalo de saída.** Nenhum componente, hook, rota ou server
   function chama `fetch` na API externa diretamente. Toda chamada passa pelo
   método único do provider (`graph()`/`call()`), onde vivem budget, timeout,
   contagem e classificação de erro.
2. **Módulos de limite/decisão são puros e testáveis** (sem I/O), para que os
   limites tenham teste unitário sem tocar a rede.
3. **Credenciais nunca aparecem em log nem em chave de cache** — usar
   fingerprint não reversível (ver `tokenFingerprint`).
4. **Server-only.** Chave/segredo lido dentro do handler (`process.env[...]`),
   nunca em escopo de módulo, nunca no cliente.

---

## 1. Request budget (teto duro por operação)

Obrigatório. Tetos por página/entidade são multiplicativos e explodem em contas
grandes; só um teto global de requisições protege a quota.

- Constante nomeada e exportada: `MAX_REQUESTS_PER_<OPERAÇÃO>` (Meta: 200).
- Contador incrementado no provider, verificado **antes** de cada chamada.
- Ao atingir: **parar imediatamente**, preservar tudo o que já foi obtido,
  devolver `stopReason = "request_budget"`, emitir warning em pt-BR e **nunca**
  fazer retry automático.
- Tetos secundários também obrigatórios quando houver paginação/fan-out:
  `MAX_PAGES_PER_EDGE`, `MAX_<ENTIDADE>_PER_SCAN`.

## 2. Timeout e deadline

- **Timeout por request** via `AbortController` (Meta: 15s). Sem timeout, um
  socket pendurado consome o worker inteiro.
- **Deadline por operação** (Meta: `SCAN_DEADLINE_MS = 45s`): ao estourar,
  retorno parcial com `stopReason = "deadline"`, nunca exceção genérica.
- `abortSignal` do chamador é propagado até o `fetch`.

## 3. Cache

- Cache TTL em memória por chave = `fingerprint(credencial) + modo + parâmetros`.
- TTLs declarados como constantes com justificativa (Meta: scan 120s,
  `/debug_token` 300s).
- Resultados de leitura persistidos no banco quando fazem parte do estado do
  produto — nunca refazer varredura completa para renderizar uma tela.
- **Refresh incremental por padrão**: quando os dados salvos ainda são válidos,
  usar a variante barata da chamada. Operação completa/profunda somente em:
  credencial nova, ausência de cache, cache expirado ou pedido explícito do
  usuário.

## 4. Deduplicação (in-flight)

- Chamadas concorrentes com a mesma chave **compartilham a mesma promise**
  (`createSharedCache`): a segunda trilha gera **zero** requisições.
- Obrigatório onde duas trilhas de UI podem disparar juntas (retorno de OAuth +
  abertura de modal, botão + query automática).
- A UI também precisa de guard de reentrada (ref booleana) — a query key
  observada pelo botão deve ser a mesma que executa a operação.

## 5. Limite de concorrência

- Proibido `Promise.all` irrestrito sobre listas vindas de terceiros.
- Usar `mapLimit(items, limit, fn)` com limite nomeado
  (`PORTFOLIO_CONCURRENCY = 3`, `ANALYTICS_CONCURRENCY = 4`).
- Fan-out abortável: cada worker checa budget/deadline/rate-limit antes de nova
  chamada.

## 6. Retry / backoff

- **Retry condicional, nunca cego.** Só quando o erro é retryable:
  5xx, erro de conjunto de campos/recurso inexistente, falha de rede.
- **Nunca** retry em: rate limit, credencial inválida/expirada (ex.: código 190),
  4xx de validação, budget/deadline esgotados.
- Backoff exponencial com jitter e teto de tentativas (máx. 2 extras);
  cada tentativa consome budget e é contada na telemetria (`retries`).
- Camada de dados (React Query) das operações caras: `retry: false` — o retry
  pertence à integração, não à UI.

## 7. Rate limit

- Conjunto explícito de códigos do provedor + HTTP 429
  (`RATE_LIMIT_CODES`, `isRateLimitError`).
- Ao detectar: interromper a travessia, **preservar dados parciais**, marcar
  `stopReason = "rate_limited"`, registrar `rateLimits` na telemetria e
  persistir janela de espera quando o provedor informar (`*_rate_limited_until`).
- **Cooldown de reentrada** para ação manual (persistente, não só de UI) e
  mensagem acionável em pt-BR (ver `src/lib/meta/issue-messages.ts`).

## 8. Circuit breaker (quando aplicável)

Obrigatório quando a integração é chamada em laço, por cron/worker, ou quando a
falha do provedor pode travar filas (IA, publicação, webhooks de saída).

- Estados `closed → open → half-open`; abre após N falhas consecutivas
  classificadas como do provedor (5xx/timeout/rate limit).
- Enquanto `open`: falhar rápido, sem chamada de rede, com erro tipado
  (`provider_unavailable`) e mensagem clara na UI.
- `half-open` após janela de espera: uma chamada de sondagem define reabrir ou
  reabrir o circuito.
- Não aplicável (e dispensável) em ações pontuais disparadas manualmente pelo
  usuário — nesses casos valem cooldown + rate limit.

## 9. Observabilidade

- Uma **telemetria por operação** (`createGraphTelemetry`) com:
  `operationId`, `startedAt/finishedAt`, `durationMs`, `requests`,
  `byEndpoint` (endpoint normalizado, sem IDs), `cacheHits/cacheMisses`,
  `paginationPages`, contagens de entidades, `retries`, `rateLimits`,
  `stopReason`.
- Uma linha de log estruturada por operação, incluindo o caso de custo zero
  (`requests=0 cache=cache|inflight`).
- Endpoints normalizados (`/{id}/owned_pages`) para agregação.
- **Proibido logar** token, segredo, cabeçalho de autorização ou PII.
- Todo estado terminal precisa de estado visual correspondente: sucesso,
  parcial/atenção (warnings), erro acionável — nunca skeleton infinito.

---

## 10. Checklist de revisão (bloqueante)

Uma nova integração só entra se todos os itens estiverem marcados:

- [ ] Ponto único de saída HTTP no `provider.server.ts`
- [ ] `MAX_REQUESTS_*` verificado antes de cada chamada, com parada e dados parciais
- [ ] Timeout por request (`AbortController`) + deadline por operação
- [ ] Tetos de paginação e de entidades por operação
- [ ] Cache TTL com chave por fingerprint de credencial
- [ ] Modo incremental por padrão; completo apenas nos 4 casos previstos
- [ ] Dedupe in-flight + guard de reentrada na UI
- [ ] `mapLimit` com limite nomeado (sem `Promise.all` solto)
- [ ] Retry condicional com backoff/jitter e teto; `retry: false` na camada de dados
- [ ] Rate limit classificado, cooldown persistente e mensagem em pt-BR
- [ ] Circuit breaker quando a integração roda em laço/cron/fila
- [ ] Telemetria por operação + log estruturado, sem segredos
- [ ] Testes unitários dos módulos puros (limites, política, merge, classificação de erro)
- [ ] Guards de RBAC/RLS preservados nas server functions da integração

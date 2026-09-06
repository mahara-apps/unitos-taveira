# Por que apareceu "Falha ao decriptar token da conexão" na Taveira

## O que aconteceu

Os tokens das contas Meta não ficam guardados em texto puro: eles são gravados
no banco da Taveira **embaralhados com uma chave secreta exclusiva daquela
instalação**. Para ler o token de volta, é preciso exatamente a mesma chave que
embaralhou.

O provisionamento da Taveira, hoje, **cria uma chave nova a cada execução** e
sobrescreve a antiga no painel de deploy. Como a instalação da Taveira foi
provisionada/reexecutada várias vezes (por causa dos erros de GitHub, Vercel e
schema), a chave atual não é mais a mesma que embaralhou os tokens já
conectados. Resultado: os tokens continuam lá, mas ilegíveis — e cada métrica
que precisa deles falha com essa mensagem.

Isso explica o quadro da tela: 2 contas conectadas, 0 de 2 lendo dados, 4
métricas falhando com a mesma frase.

## Como resolver (duas frentes)

### 1. Destravar a Taveira agora

Os tokens antigos são irrecuperáveis — não existe como desembaralhar sem a chave
que foi perdida. A saída é **reconectar as 2 contas Meta na Taveira**: ao
reconectar, novos tokens são gravados com a chave atual e as métricas voltam.

Para isso a tela precisa dizer isso com clareza, em vez de mostrar um erro
técnico: quando a leitura do token falha por chave trocada, o aviso passa a ser
"Conexão precisa ser reconectada" com o botão que leva direto à reconexão.

### 2. Impedir que aconteça de novo (a correção de verdade)

O provisionamento nunca deve trocar uma chave que já está protegendo dados. A
chave passa a ser **gerada uma única vez por instalação e reutilizada** em toda
execução seguinte, guardada de forma cifrada no MASTER junto das outras
credenciais da instalação. Reexecutar o provisionamento deixa de invalidar
conexões existentes.

Vale para as quatro chaves próprias da instalação, não só a dos tokens: trocar
qualquer uma delas no meio do caminho quebra algo (agendamentos, retorno do
Meta, webhook).

## Detalhes técnicos

**Causa raiz confirmada**
- `src/lib/social-analytics/service.server.ts:206-214`: `decryptCredential` falha
  e vira `SocialServiceError("token_decrypt_failed")`.
- `src/lib/credentials-crypto.server.ts`: chave AES-256-GCM derivada por SHA-256
  de `BRAND_CREDENTIALS_SECRET`. Segredo diferente = decrypt falha (e ausência do
  segredo cai no mesmo erro genérico).
- `src/lib/installation/automation.server.ts:2147-2148`: laço sobre
  `GENERATED_SECRET_VARS` chamando `generateInstallationSecret()` — valor novo em
  cada execução.
- `src/lib/installation/automation.server.ts:1432-1445`: `setEnv` grava com
  `upsert=true`, sobrescrevendo o segredo anterior na Vercel.
- O checkpoint que evita regeração (`readStageProgress`) é **por operação**, não
  por instalação: uma nova operação regenera tudo.

**Mudanças**
1. `installation_credentials` (já cifrado por instalação) passa a guardar os
   valores de `GENERATED_SECRET_VARS`. Nova função
   `ensureInstallationSecrets(installationId)` em
   `src/lib/installation/credentials.server.ts`: lê os existentes, gera apenas
   os ausentes, persiste e devolve o conjunto completo.
2. `automation.server.ts` troca o laço de geração por
   `ensureInstallationSecrets`. `assertSecretsAreExclusive` continua rodando
   (reuso do MASTER segue proibido); o teste de "curto demais" é preservado.
3. `buildDeployEnvPlan` permanece igual — recebe os segredos resolvidos.
4. Nova rotação explícita e opt-in: `rotateInstallationSecret(name)` na aba
   Acessos, com aviso de que rotacionar `BRAND_CREDENTIALS_SECRET` exige
   reconectar as contas. Nunca automática.
5. UX do erro: `service.server.ts` distingue `token_decrypt_failed` de
   `connection_missing_token`; `connections.tsx` e o aviso de Analytics passam a
   mostrar "reconectar" com ação, em vez do texto cru.
6. Marcação de estado: conexão cujo token não decripta recebe
   `needs_reconnect` para o aviso não depender de a métrica falhar.
7. Testes: reutilização idempotente dos segredos, recusa de reuso do MASTER,
   classificação do erro de decrypt.
8. Regerar `007_delta_migrations.sql`, subir `MASTER_RELEASE_VERSION` e aplicar
   na Taveira. Reconectar as 2 contas Meta lá depois.

**Fora de escopo**: recuperar os tokens atuais da Taveira (matematicamente
impossível) e mexer em RBAC/RLS.

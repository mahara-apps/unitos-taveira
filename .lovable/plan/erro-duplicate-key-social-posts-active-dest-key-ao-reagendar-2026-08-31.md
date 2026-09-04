# Erro "duplicate key … social_posts_active_dest_key" ao reagendar

## O que aconteceu (confirmado nos dados)

A peça que você tentou reagendar (`12ac5e3f…`) tem, agora, **uma publicação do Instagram ainda ativa na fila**:

```text
facebook / feed   → published (ok)
instagram / feed  → scheduled, 2 tentativas, último erro:
                    "Meta: Application request limit reached (code 4)"
```

Essa linha em `scheduled` é justamente o novo comportamento de espera por limite
de requisições da Meta: o item não falha, ele volta para a fila para tentar de novo.

Quando você clicou em reagendar/publicar, o sistema tentou **criar outra linha**
para o mesmo destino (peça + conta + feed). O banco tem um índice que garante
um único item ativo por destino (`social_posts_active_dest_key`) e recusou a
inserção. O erro técnico do Postgres subiu cru para a tela.

Ou seja: não é corrupção de dados nem problema de autorização. É uma proteção
de duplicidade funcionando, mas em dois pontos o fluxo não a respeita e a
mensagem não explica nada ao operador.

## Correções

### 1. Não colidir com o item já ativo
- No fluxo "publicar agora" do wizard, antes de inserir o registro do destino,
  encerrar (status `cancelled`) o item pendente do mesmo destino que não esteja
  travado por worker (`publish_locked_at` nulo). Hoje esse fluxo insere direto.
- No fluxo de reagendamento, incluir também linhas `publishing` órfãs
  (sem lock) na limpeza — hoje só `scheduled` e `failed` são encerradas.
- Nunca tocar em linha `published` nem em linha com lock ativo (worker drenando).

### 2. Mensagem em português no lugar do erro do banco
Traduzir a violação do índice, em todos os pontos que inserem na fila, para algo
como: "Já existe uma publicação na fila para Instagram/Feed. Ela está aguardando
nova tentativa (limite de requisições da Meta). Cancele o item na fila ou aguarde."

### 3. Deixar visível que o item está "aguardando nova tentativa"
No detalhe de publicação, um destino com item `scheduled` e último erro de limite
deve aparecer como **"Aguardando nova tentativa"** (com horário previsto, quando
houver `next_attempt_at`), não como falha — e o botão de reenviar fica
desabilitado com essa explicação, evitando o clique que gera o erro.

### 4. Ação explícita de cancelar da fila
Botão "Cancelar da fila" no destino pendente (mesma autorização do reenvio), para
quem quer reagendar imediatamente em vez de esperar o backoff.

## Detalhes técnicos

- `src/lib/scheduling-wizard.functions.ts`: limpeza pré-insert no ramo
  `publish` e ampliação do `update … cancelled` no ramo `schedule`.
- `src/lib/publish-retry.functions.ts`: estado do destino passa a distinguir
  `awaiting_retry` de `failed` usando `status`, `last_error`, `next_attempt_at`,
  `deferred_since`; nova função de cancelamento do item pendente.
- Helper único de mensagem para violação de `social_posts_active_dest_key`.
- `src/components/social/publication-detail.tsx` e o wizard: rótulos pt-BR,
  botão desabilitado com motivo, ação de cancelar.
- Fuso `America/Sao_Paulo` para exibir o horário da próxima tentativa.
- Sem migration, sem mudança de RBAC/RLS/auth e sem publicação automática.
- Testes: colisão de destino ativo, reagendar após cancelar, e destino
  rate-limited não classificado como falha.

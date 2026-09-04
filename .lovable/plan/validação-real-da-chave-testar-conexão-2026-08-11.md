# Validação real da chave ("Testar conexão")

Hoje `saveProviderKey` cifra e salva a chave sem nunca falar com o provedor: uma chave errada, revogada ou sem crédito só é descoberta quando um fluxo de IA falha. A ideia é testar a chave antes de marcar o provedor como conectado.

## Comportamento

- **Ao salvar a chave**: a chave é testada contra o provedor antes de gravar.
  - Sucesso: salva, marca como conectado e mostra "OpenAI conectado — chave válida".
  - Falha de autenticação (401/403): **não salva**, e o diálogo mostra o motivo em português ("Chave inválida ou revogada").
  - Falha temporária (rede, 429, 5xx): salva a chave, mas marca o estado como "não verificada" e avisa que a verificação será refeita depois.
- **Botão "Testar conexão"** no card de cada provedor já conectado, para revalidar a chave existente sem precisar redigitá-la.
- **Estado por provedor**: além de "Conectado", o card mostra o resultado do último teste (válido / inválido / não verificado) com a data, e o selo fica em alerta quando a última verificação falhou.
- **Modelos disponíveis**: o teste também registra se o modelo ativo do papel (texto/imagem) aparece na lista da conta, alimentando o painel "Modelos em uso" já existente.

## Como o teste é feito

Chamada mínima e barata por provedor, apenas de leitura (sem gerar tokens):

- OpenAI: lista de modelos da conta.
- Anthropic: lista de modelos da conta.
- Gemini: lista de modelos da conta.

Timeout curto (~8s) para o cadastro não ficar travado.

## Detalhes técnicos

- Novo helper `src/lib/ai-provider-verify.server.ts` com `verifyProviderKey(provider, apiKey)`, retornando `{ status: "valid" | "invalid" | "unverified", message?, models? }` e classificando o erro (401/403 → `invalid`; rede/429/5xx → `unverified`).
- `saveProviderKey` (`src/lib/connections.functions.ts`) chama o helper antes do upsert; em `invalid` lança erro com mensagem amigável e não grava nada. O `ProviderConfig` em `brand_connections.providers` ganha `verified`, `verifiedAt` e `verifyMessage`.
- Nova server fn `testProviderKey({ brandId, provider })`: descifra a chave salva, roda o mesmo helper, atualiza o estado de verificação e retorna o resultado.
- UI em `src/routes/_authenticated/connections.tsx` (`ProviderCard`): botão "Testar conexão", indicador do último teste e mensagem de erro inline no diálogo de cadastro.
- A verificação diária de modelos já existente passa a marcar como `invalid` provedores cuja chave falha na autenticação, notificando os super admins pelo canal in-app já implementado.

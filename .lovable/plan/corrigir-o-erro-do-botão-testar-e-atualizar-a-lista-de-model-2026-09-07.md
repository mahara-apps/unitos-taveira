# Corrigir o erro do botão "Testar" e atualizar a lista de modelos de IA

## O que já está claro

1. **O aviso amarelo não é erro.** "groq: openai/gpt-oss-20b substituiu llama-3.3-70b-versatile" quer dizer que o modelo antigo da Groq saiu do ar e o sistema trocou sozinho para outro que funciona. Nada quebrou — mas o texto está em linguagem de máquina.
2. **O erro do "Testar" é real.** Aparece o texto cru "The operation failed for an operation-specific reason", que é a falha de leitura da chave guardada. As telas de IA (Testar, Rotacionar, Verificar agora, Remover) ainda mostram esse texto sem tradução — a tradução em português só foi aplicada nas telas de plano de mídia.
3. **A lista de modelos está velha.** A tela oferece GPT-5, Claude Sonnet 4.5, Gemini 2.5 Pro/Flash e Llama 3.3 70B — modelos de geração anterior; o próprio aviso da Groq mostra que um deles já saiu do ar.

## Passo 1 — Confirmar a causa do "Testar"

Rodar o teste da chave neste ambiente e ler o erro real do servidor. Duas possibilidades:
- a chave salva não pode mais ser lida aqui (senha de segurança da instalação mudou) → basta salvar a chave de novo;
- ou o erro vem de outro ponto do teste (gravação do resultado), e nesse caso a correção é nesse ponto.

A correção final segue o que o teste mostrar; nada será alterado por suposição.

## Passo 2 — Nenhuma tela de IA mostra texto técnico

Aplicar a tradução em português já existente em todos os avisos da tela de IA: Testar, Testar e salvar, Rotacionar chave, Remover e "Verificar agora". Quando a chave não puder ser lida, a mensagem diz o que fazer: "A chave salva não pôde ser lida nesta instalação. Salve a chave novamente."

## Passo 3 — Estado do cartão coerente

Se o teste falhar por chave ilegível, o cartão deixa de mostrar "Chave válida"/"Conectado" e passa a "Precisa salvar a chave novamente", com o horário do último teste.

## Passo 4 — Aviso de troca de modelo em linguagem simples

Reescrever o aviso para: "Groq: o modelo Llama 3.3 70B saiu do ar e foi substituído automaticamente por GPT-OSS 20B", usando os nomes amigáveis já cadastrados na tela.

## Passo 5 — Atualizar a lista de modelos

Atualizar os modelos oferecidos por provedor para a geração atual, mantendo os antigos apenas como reserva automática (o mecanismo de troca automática continua igual). Remover da lista o modelo da Groq que já saiu do ar.

## Passo 6 — MASTER-first

Regra fixa: aplicar no MASTER, regenerar o pacote de propagação, subir a versão em `delta_version.txt` e `MASTER_RELEASE_VERSION` (1.2.3), rodar `bun run master:check`, publicar e então autorizar "Atualizar" nas outras instalações.

## Detalhes técnicos

- `src/components/connections/ai-center.tsx`: usar `aiErrorMessage` nos `onError`/`onSuccess` de `testMut`, `saveMut`, `removeMut` e `runMut`; derivar o rótulo do cartão de `verified` incluindo o novo estado ilegível; formatar o bloco `replaced` com os labels de `AI_PROVIDERS` em vez dos ids.
- `src/lib/connections.functions.ts`: garantir que a gravação do estado inválido não lance (é ela a suspeita secundária do erro atual) e que `removeProviderKey`/`testProviderKey` nunca propaguem `DOMException`.
- `src/lib/ai-models-catalog.server.ts` + `AI_PROVIDERS`: atualizar `MODEL_CATALOG` e as cadeias de fallback para ids atuais, mantendo `openai/gpt-oss-120b` e `openai/gpt-oss-20b` na Groq e removendo `llama-3.3-70b-versatile` do topo da cadeia.
- Teste unitário cobrindo: erro de credencial ilegível traduzido na tela de IA e cadeia de fallback sem o modelo descontinuado.

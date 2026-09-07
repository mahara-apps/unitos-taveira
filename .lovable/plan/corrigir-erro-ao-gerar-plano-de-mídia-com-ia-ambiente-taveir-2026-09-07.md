# Corrigir erro ao gerar plano de mídia com IA (ambiente Taveira)

## O que aconteceu

A mensagem que apareceu na tela ("The operation failed for an operation-specific reason") não é uma mensagem do sistema: é o texto cru que o navegador/servidor devolve quando a **chave de IA guardada do workspace não consegue ser aberta** (a senha de segurança da instalação não corresponde à que criptografou a chave). Hoje esse erro passa direto para a tela sem tradução, então quem usa não entende o que fazer.

Duas causas possíveis nesse ambiente, e ainda não é possível confirmar qual delas sem checar a instalação Taveira:

1. A senha de segurança da instalação foi trocada/regerada depois que a chave de IA foi salva — nesse caso a chave precisa ser salva de novo.
2. A instalação ainda não recebeu a atualização mais recente do MASTER (versão 1.2.1), que contém os campos novos do plano de mídia com entrevista.

## Passo 1 — Confirmar a causa (antes de qualquer correção)

- Verificar em Taveira se a versão instalada já é 1.2.1 e se os campos novos do plano de mídia existem (relatório de saúde da instalação).
- Verificar se a chave de IA do workspace continua válida (teste de conexão do provedor).

O resultado define se a correção é "salvar a chave novamente", "aplicar a atualização", ou ambos.

## Passo 2 — Erros compreensíveis (vale para todo o sistema)

- Traduzir a falha de leitura de chave guardada para uma mensagem clara em português, dizendo exatamente o que fazer: "A chave de IA salva não pôde ser lida nesta instalação. Salve a chave novamente em Configurações > IA."
- Aplicar isso em todos os pontos que usam chaves guardadas (IA, e-mail, Meta, WhatsApp), para que nenhum deles volte a mostrar texto técnico do navegador.
- No assistente de plano de mídia, mostrar a mensagem real (e não a genérica) quando a geração falhar.

## Passo 3 — Aviso preventivo na tela de IA

Na tela de configuração de IA, quando a chave salva não puder ser lida, mostrar o estado "chave precisa ser salva novamente" em vez de aparentar estar tudo certo.

## Passo 4 — MASTER-first

Como a correção é de código, seguir a regra fixa: aplicar no MASTER, regenerar o pacote de propagação, subir a versão em `delta_version.txt` e `MASTER_RELEASE_VERSION` (1.2.2), rodar `bun run master:check`, publicar e então autorizar a atualização em Taveira e nas demais instalações.

## Detalhes técnicos

- `src/lib/credentials-crypto.server.ts`: `decryptCredential` propaga o `DOMException: OperationError` do `crypto.subtle.decrypt`. Envolver em erro de domínio (`CredentialDecryptError`) com mensagem pt-BR e código estável.
- Ajustar os consumidores de `decryptCredential` (`ai-provider.server.ts`, `ai-model-health.server.ts`, `email/resend.server.ts`, `evolution/config.server.ts`, `meta/*`) para tratar esse código e devolver mensagem acionável.
- `create-media-plan-dialog.tsx`: exibir `err.message` também nos casos de erro sem `Error` tipado, com fallback atual.
- Teste unitário novo cobrindo a tradução do erro de decriptação.

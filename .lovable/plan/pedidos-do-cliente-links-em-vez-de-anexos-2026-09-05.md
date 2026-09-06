# Pedidos do cliente: links em vez de anexos

## O que muda para o cliente

No formulário "Novo pedido" (área do cliente):

- Sai o campo "Anexos (até 5)" — nada mais é enviado para o armazenamento.
- Entra "Links de referência (até 10)": o cliente cola um endereço (Google Drive, Docs, Figma, Dropbox, WeTransfer, YouTube etc.), pode dar um nome curto opcional e clicar em "Adicionar". Cada link entra numa lista com o ícone/nome do serviço reconhecido e um botão para remover.
- Endereço inválido mostra aviso na hora e não é adicionado; links repetidos são ignorados.
- Na lista de pedidos e no detalhe do pedido, os links aparecem como itens clicáveis (abrem em nova aba), no lugar da contagem de anexos.
- Pedidos antigos que já tenham arquivos continuam mostrando esses arquivos, somente para leitura — nada é apagado.
- Quem entra por link sem senha continua sem poder criar pedido.

## Como fica tecnicamente

Banco (uma migração):

- Nova coluna `client_requests.links jsonb not null default '[]'` guardando `{ url, title, source }`. Nenhuma tabela nova, nenhum arquivo no storage.

Backend (`src/lib/portal-requests.functions.ts`):

- `createPortalRequestFn`: novo campo `links` (máx. 10) validado com `normalizeLinkUrl` + `detectLinkSource` de `src/lib/link-source.ts`; título opcional até 160 caracteres; URL até 2000. O parâmetro `attachments` deixa de ser aceito na criação (upload removido, `MAX_ATTACHMENT_BYTES` e helpers de base64 saem do caminho de criação).
- Leitura (`mapRequest`/`REQUEST_COLUMNS`): passa a devolver `links` normalizados junto de `attachments` (mantidos apenas para exibir histórico).
- Permissões inalteradas: tudo continua atravessando `resolvePortalSessionScope` com o módulo `requests` e nível de interação.

Frontend (`src/components/portal/portal-requests.tsx`):

- `NewRequestDialog`: troca o `input type="file"` por um mini-editor de links (campo URL + campo nome opcional + botão Adicionar + lista com remover), mobile-first, usando os rótulos de `LINK_SOURCE_LABEL`.
- Cartão do pedido: badge de anexos vira contagem de links (mantém o de anexos só quando o pedido antigo tiver arquivos).
- Detalhe do pedido: seção "Links" com os endereços clicáveis, acima da seção de arquivos legados.

Testes e propagação:

- Testes unitários da normalização de links do pedido (URL inválida, duplicada, limite de 10) em `tests/portal-permissions.unit.test.ts` ou arquivo novo `tests/portal-requests-links.unit.test.ts`.
- Regenerar o delta de instalações e subir `MASTER_RELEASE_VERSION` para que Taveira e futuras instalações recebam a coluna nova.

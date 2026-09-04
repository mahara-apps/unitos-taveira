# Publicação do código no GitHub: correção definitiva

## O que está acontecendo hoje (verificado)

A operação de `unitos-taveira` está viva desde 15:14 (status `running`, último sinal 15:25), parada na etapa "Código no GitHub". A causa não é permissão agora — é o método de publicação:

- O repositório da instalação foi criado **vazio** (a criação pelo template falhou antes com 403), então não compartilha objetos com o MASTER.
- Sem objetos compartilhados, a publicação copia **arquivo por arquivo**: o projeto tem 1.308 arquivos e cada um exige 2 chamadas ao GitHub (ler no MASTER + gravar no destino) → cerca de 2.600 chamadas em sequência.
- Isso não cabe na janela de execução em segundo plano. A tarefa é cortada, o vigia reinicia a mesma etapa **do zero** (não há checkpoint dentro da publicação) e o ciclo se repete indefinidamente, sem avanço visível.

## O que vamos fazer

### 1. Caminho rápido: reaproveitar os objetos do MASTER
Quando o repositório da instalação for criado a partir do MASTER (template ou fork), os arquivos já existem do outro lado e a publicação passa a exigir **3 chamadas** em vez de 2.600 — conclui em segundos. A criação passa a tentar, nesta ordem: template → fork do MASTER → repositório vazio, e o motivo real de cada recusa fica registrado na etapa.

### 2. Publicação retomável (quando o caminho rápido não estiver disponível)
- Cópia em paralelo controlado (8 por vez) em lotes.
- Checkpoint gravado a cada lote: o que já foi copiado não é copiado de novo.
- Orçamento de tempo por execução: ao se aproximar do limite, a etapa salva o progresso, continua "em execução" com o percentual real e o vigia retoma exatamente de onde parou.
- Recuo automático em limite de uso do GitHub (403/429, respeitando `Retry-After`), sem derrubar a operação.

### 3. Saída manual oficial (o que você pediu)
Na aba "Acessos" da instalação: campo para informar um repositório já criado à mão a partir do template, com um botão "Usar este repositório". O sistema confere se o conteúdo corresponde à versão do MASTER e marca a etapa como concluída, seguindo direto para Vercel, variáveis e banco. Nada é publicado por cima do que você criou.

### 4. Diagnóstico antes de tentar
Um teste de GitHub no cartão de credenciais informa, em linguagem clara: se o token alcança a organização, se pode criar repositórios e se o MASTER está marcado como template — antes de iniciar o provisionamento, em vez de descobrir na metade.

### 5. Interromper o ciclo atual
A operação presa de `unitos-taveira` é encerrada de forma controlada e o botão de retomar passa a usar o novo fluxo, já com checkpoint.

## Detalhes técnicos

- `src/lib/installation/automation.server.ts`
  - `createCodeClient.ensureRepo`: cadeia template → `/repos/{master}/forks` → repositório vazio; erro final agrega o motivo de cada tentativa.
  - `publishSnapshot`: detecta objetos compartilhados (tenta `GET /repos/{target}/git/blobs/{sha}` de uma amostra do MASTER); se disponível, monta a árvore diretamente com os SHAs do MASTER (tree + commit + update ref).
  - Caminho de cópia: concorrência 8, lotes de ~100 arquivos, `blobMap` persistido em `readStageProgress`/`saveStageProgress`, orçamento de tempo (~20 s por execução) e retorno `{ ok: true, partial: true }`.
  - Etapa `code` no `runProvision`: em `partial`, mantém `mark("code","running", detalhe, percent)` e devolve o controle sem falhar; o watchdog retoma.
- `src/lib/installation/manager.functions.ts`: nova server function `adoptInstallationRepositoryFn` (Super Admin) que valida `owner/repo`, compara a árvore com o `MASTER_RELEASE_VERSION` e grava `codeDone/codeSha/codeRepo`; e ampliação do teste de credenciais com permissões do GitHub e `is_template` do MASTER.
- `src/components/installations/installation-credentials-card.tsx`: campo + ação "Usar este repositório" e exibição do diagnóstico do GitHub.
- Testes: publicação com objetos compartilhados, retomada por checkpoint sem recopiar, respeito ao orçamento de tempo, e adoção de repositório manual.

Sem mudanças de banco. RBAC/RLS preservados: todas as ações continuam restritas ao Super Admin da instalação MASTER.

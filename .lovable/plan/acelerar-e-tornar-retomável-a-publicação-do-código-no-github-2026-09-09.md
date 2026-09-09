# Acelerar e tornar retomável a publicação do código no GitHub

## Diagnóstico confirmado

O erro da imagem acontece na chamada final que cria a árvore Git no repositório da instalação. Hoje essa chamada:

- envia a lista de arquivos alterados ao GitHub em uma única requisição;
- não tenta novamente quando o GitHub responde `502`;
- no fluxo de **atualização**, roda sem limite de tempo e sem salvar o progresso dos arquivos já copiados;
- portanto, uma falha tardia pode fazer a próxima tentativa repetir trabalho demorado.

O provisionamento inicial já possui checkpoint e janela curta para a cópia de arquivos, mas a atualização não reutiliza essa proteção.

## Correção

### 1. Eliminar a montagem desnecessária da árvore no caminho rápido

Quando o repositório da instalação veio do template/fork e compartilha os objetos do MASTER, usar diretamente a árvore raiz do commit autorizado.

Isso remove a requisição que falhou no print e reduz o caminho normal a: validar a árvore, criar o commit e atualizar a branch. O resultado continua sendo um snapshot exato do MASTER, inclusive removendo arquivos antigos.

### 2. Retry específico para instabilidade do GitHub

Aplicar tentativas limitadas, com espera progressiva e respeito a `Retry-After`, para `429`, `502`, `503` e `504` nas operações idempotentes de leitura/criação de blobs e árvores.

- Nunca repetir erros permanentes de permissão ou validação (`401`, `403`, `404`, `422`).
- Exibir “instabilidade temporária do GitHub” quando as tentativas se esgotarem, sem sugerir problema no token.
- Manter limite de tentativas para impedir laço infinito.

### 3. Tornar atualizações retomáveis como o provisionamento

Aplicar também ao fluxo de atualização:

- orçamento curto por execução;
- checkpoint dos blobs já copiados, ligado ao SHA do MASTER;
- retomada automática exatamente do ponto salvo;
- descarte seguro do checkpoint se o commit de origem mudar;
- progresso real na tela, incluindo quantidade concluída e restante.

A operação não será finalizada como falha apenas porque a janela da execução terminou; ficará em andamento para o vigia continuar.

### 4. Evitar repetição após falha na etapa final

Salvar o estado imediatamente antes de montar árvore/criar commit. Se houver erro transitório nessa fase, a retomada reutiliza todos os blobs já enviados e repete somente as poucas chamadas finais.

O botão **Tentar novamente** também aproveitará esse estado quando a origem e o repositório forem os mesmos, em vez de reiniciar a publicação completa.

## Testes

Cobrir os dois caminhos, instalação inicial e atualização:

- template/fork publica sem `POST /git/trees` desnecessário;
- `502` temporário recupera após espera;
- `502` persistente encerra com mensagem correta e sem acusar credencial;
- atualização grande devolve estado parcial e retoma sem recopiar blobs;
- falha após a cópia retoma apenas árvore/commit;
- mudança do SHA do MASTER invalida checkpoint antigo;
- nenhuma operação entra em repetição infinita.

## MASTER-first

Não exige mudança de banco. A correção será incluída no próximo release do MASTER, com pacote regenerado, versões sincronizadas e `master:check` completo. Depois será necessário publicar o MASTER e autorizar a atualização das instalações.

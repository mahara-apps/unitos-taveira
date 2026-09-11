# Tornar o provisionamento do GitHub simples e rápido

## Diagnóstico confirmado

A sua sugestão está correta: a instalação nova deve nascer como uma cópia completa do template do MASTER, sem reconstruir o projeto arquivo por arquivo.

No fluxo atual, o sistema já tenta criar pelo template, mas, se essa tentativa falha, ele tenta fork e depois cria um repositório vazio. Foi o que ocorreu com a Casa 8: o repositório ficou somente com o README de inicialização. Nas tentativas seguintes, esse repositório é considerado “existente”, então o template não é tentado novamente e o sistema entra na cópia lenta seguida da montagem de árvore que retornou HTTP 502.

No registro do MASTER, Casa 8 está em erro, sem versão instalada, sem commit fixado e sem operação ativa. Portanto, o código realmente não chegou a ser aplicado.

## Correção

### 1. Template será o único caminho para uma instalação nova

- Criar o repositório diretamente com **Generate from template** do GitHub.
- Remover o fallback silencioso que cria repositório vazio.
- Não usar fork como alternativa automática para instalações novas.
- Se o template não puder ser gerado, parar imediatamente e mostrar a permissão/configuração exata que falta.

Resultado esperado: o repositório já nasce com todo o código do MASTER em uma única operação do GitHub.

### 2. Não republicar o código depois de gerar o template

Depois que o GitHub confirmar a criação:

- aguardar a branch `main` ficar disponível;
- conferir o arquivo de versão e o commit criado;
- registrar esse commit como código provisionado;
- seguir diretamente para conectar a Vercel.

Isso elimina, no provisionamento inicial, leitura de milhares de arquivos, criação de blobs e `POST /git/trees`.

### 3. Recuperar automaticamente o caso Casa 8

Adicionar uma recuperação segura para repositórios incompletos criados pelo próprio sistema:

- reconhecer somente o padrão descartável confirmado: branch com apenas o README padrão “Instalação Unitos. Código publicado a partir do MASTER”, sem versão instalada;
- exigir a confirmação crítica já usada pelo Installation Manager;
- excluir esse repositório incompleto;
- recriá-lo imediatamente pelo template do MASTER com o mesmo nome;
- validar o código completo e reconectar a Vercel ao novo repositório.

Qualquer repositório com outro arquivo, commit não reconhecido ou versão instalada será preservado e exigirá ação manual — nunca será apagado automaticamente.

### 4. Pré-validação antes de iniciar

O teste de acessos passará a bloquear o provisionamento se:

- o MASTER não estiver marcado como template;
- o token não puder gerar um repositório na organização de destino;
- já existir um repositório incompatível com o provisionamento rápido.

A tela mostrará “Criação rápida disponível” somente após uma verificação real do endpoint de template e das permissões necessárias.

### 5. Separar criação inicial de atualização

- **Instalação nova:** sempre cópia integral pelo template, em segundos.
- **Atualização futura:** mantém o mecanismo retomável existente, pois o GitHub não aplica novamente um template sobre um repositório já existente.
- A atualização nunca poderá voltar a usar o fallback de repositório vazio.

## Testes e validação

Cobrir:

- repositório novo nasce completo pelo template e pula a montagem de árvore;
- falha do template encerra antes de criar repositório vazio;
- repositório com somente o README padrão é reconhecido como recuperável;
- repositório com qualquer conteúdo real nunca é excluído;
- recuperação recria pelo template, valida a versão e reconecta a Vercel;
- retomada não repete criação nem publicação já concluída;
- mensagens distinguem permissão, limite de uso e instabilidade do GitHub.

## MASTER-first

A correção será aplicada no MASTER, com versão e pacote sincronizados, testes do Installation Manager e `master:check`. Depois, o MASTER precisa ser publicado; em seguida, a Casa 8 será recuperada pelo novo fluxo e validada até o código completo aparecer no repositório e o deploy iniciar.

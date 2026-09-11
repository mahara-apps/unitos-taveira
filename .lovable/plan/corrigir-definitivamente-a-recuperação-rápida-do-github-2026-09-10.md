# Corrigir definitivamente a recuperação rápida do GitHub

## Diagnóstico confirmado

A cópia por template já está ativa, mas a Casa 8 ainda possui o repositório técnico incompleto criado pelo fluxo antigo, contendo apenas o README de inicialização.

Na retomada, o sistema reconhece corretamente esse caso e tenta excluir o repositório antes de gerar a cópia completa. O GitHub respondeu `HTTP 403 — Resource not accessible by personal access token` justamente no `DELETE /repos/...`.

Portanto, o bloqueio atual não é lentidão, montagem de árvore, Supabase nem falta de código no MASTER. É a exclusão do repositório antigo, uma operação mais privilegiada que não deve ser exigida do token normal de provisionamento.

## Correção

### 1. Remover a exclusão do fluxo de recuperação

Para o único caso recuperável automaticamente — repositório com exatamente o README técnico conhecido e nenhuma versão instalada — o sistema irá:

1. renomear o repositório incompleto para um nome técnico de backup;
2. arquivar esse backup para impedir uso acidental;
3. gerar uma cópia completa do template MASTER com o nome original;
4. aguardar a branch `main` e validar versão, commit e conteúdo;
5. seguir para Vercel e demais etapas sem copiar arquivos individualmente.

O token continuará exigindo apenas as permissões administrativas normais para criar e renomear repositórios. Não será solicitado poder de exclusão.

### 2. Rollback seguro

Se a geração pelo template falhar depois da renomeação:

- o sistema tentará restaurar imediatamente o nome original do repositório técnico;
- a operação ficará bloqueada com uma mensagem objetiva;
- nenhum repositório com conteúdo real será apagado ou sobrescrito;
- o backup técnico nunca será considerado o repositório operacional.

### 3. Proteções contra perda de conteúdo

A recuperação automática continuará permitida somente quando todas as condições forem verdadeiras:

- instalação ainda sem versão e sem commit provisionado;
- repositório contém apenas `README.md`;
- conteúdo do README corresponde exatamente ao texto técnico criado pelo fluxo antigo;
- nenhuma branch ou arquivo operacional adicional existe.

Qualquer divergência bloqueia a automação e preserva integralmente o repositório.

### 4. Pré-validação e mensagens

O teste de acessos e o formulário passarão a informar e verificar:

- MASTER marcado como `Template repository`;
- acesso ao dono/organização de destino;
- criação e administração do repositório;
- capacidade de renomear o repositório técnico incompleto;
- ausência de exigência de permissão para excluir repositórios.

A mensagem da operação distinguirá “recuperando repositório técnico antigo”, “gerando cópia completa” e “validando código”, sem voltar a mostrar montagem de árvore no provisionamento inicial.

### 5. Casa 8 e retomada

Depois da publicação desta correção no MASTER, a Casa 8 poderá usar **Tentar novamente**. A retomada reconhecerá o README legado, fará a troca segura pelo template e continuará da etapa Código no GitHub, preservando a etapa Supabase já concluída.

## Testes

Cobrir:

- recuperação por renomeação e arquivamento, sem chamada `DELETE`;
- geração do template com o nome original;
- rollback do nome quando a geração falha;
- conflito de nome do backup com sufixo único;
- preservação de qualquer repositório com conteúdo real;
- retomada idempotente após interrupção entre renomear, gerar e validar;
- token sem permissão de exclusão concluindo o provisionamento;
- fluxo de atualização futura permanecendo separado e retomável.

## MASTER-first

A correção será aplicada no MASTER, pacote regenerado, versão e SHA sincronizados, testes completos e `master:check`. Depois será necessário publicar o MASTER e retomar a Casa 8.

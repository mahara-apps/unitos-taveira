# Casa 8: destravar a conexão e checar acessos antes de publicar

## O que o histórico do banco mostra (verificado agora)

As duas últimas tentativas da Casa 8 pararam sempre no mesmo ponto:

```text
BLOCKED: Repositório existente incompatível com o provisionamento rápido:
o repositório existente não corresponde à versão 1.3.36.
Gere-o novamente a partir do template do MASTER.
```

Cadastro atual da Casa 8: código em `mahara-apps/unitos-casa8`, versão gravada
1.3.35, projeto de publicação `unitos-casa8`, equipe de publicação vazia, e as
três chaves (banco, publicação, repositório) já salvas.

O que aconteceu, em ordem: a cópia manual do template foi feita quando o MASTER
estava em 1.3.35; em seguida o MASTER subiu para 1.3.36. O provisionamento
exige que a cópia tenha exatamente a versão atual do MASTER e recusa qualquer
diferença — mesmo quando a diferença é só "está uma versão atrás". Como a chave
do repositório da Casa 8 não tem permissão de Administração, ele também não
consegue gerar uma cópia nova, e o processo fica em círculo.

Antes disso a Casa 8 já havia parado por 403 na publicação (equipe não
localizada) e por instabilidade 502 do repositório — esses dois pontos já foram
tratados.

## Correção da Casa 8 (só isto)

1. **Cópia uma versão atrás deixa de ser bloqueio.** Quando a cópia veio do
   template do MASTER e está apenas desatualizada, o provisionamento segue e a
   etapa de código sincroniza a versão atual, como já acontece na atualização de
   uma instalação existente. Continua bloqueando de verdade quando a cópia não
   é do template ou não pode ser lida.
2. **A mensagem passa a dizer o que fazer**: qual versão está na cópia, qual é a
   do MASTER, e se será sincronizada automaticamente ou precisa de nova cópia.

## Checagem de acessos antes de começar

Antes de qualquer publicação, uma verificação curta valida as três chaves na
ordem em que serão usadas:

- Banco: acesso ao projeto e leitura das chaves do projeto.
- Publicação: acesso ao projeto (com localização automática da equipe).
- Repositório: leitura do template do MASTER e leitura/gravação no repositório
  da instalação.

Regras de resposta:

- 401/403: para na hora, sem iniciar a publicação, e diz qual acesso falta e em
  qual das três chaves.
- 502/503/504: tratado como instabilidade momentânea, com poucas tentativas
  espaçadas e depois um recado de "tente novamente em alguns minutos".

## Nada preso em "em andamento"

- Se a checagem inicial reprovar, a operação é encerrada como recusada, com
  motivo, e o ambiente volta a aceitar uma nova tentativa.
- Uma operação sem sinal de vida por alguns minutos aparece como travada e pode
  ser encerrada com um clique, liberando o ambiente. Verificar antes se alguma
  operação atual está nesse estado e liberá-la.

## "Testar acesso" mais claro

O botão passa a mostrar uma lista curta: cada acesso com "OK" ou exatamente a
permissão que falta, separando banco, publicação e repositório. Sem resultado
único genérico.

## Detalhes técnicos

- `src/lib/installation/automation.server.ts`: na etapa `code` do
  provisionamento, distinguir "cópia do template desatualizada" (segue e
  sincroniza) de "cópia inválida" (bloqueia); classificação compartilhada de
  erro por status HTTP (401/403 = terminal com permissão faltante;
  502/503/504 = transitório com até 3 tentativas); preflight de credenciais
  antes da primeira etapa.
- `src/lib/installation/manager.functions.ts`: `testInstallationCredentialsFn`
  devolve a lista de checagens por área usando o mesmo preflight; falha de
  preflight encerra a operação em vez de deixá-la aberta.
- `src/components/installations/*`: exibição da lista de checagens e do aviso de
  operação travada com ação de liberar.
- Testes: cópia desatualizada segue; cópia inválida bloqueia; 403 para na hora;
  502 tenta poucas vezes; preflight reprovado não deixa operação aberta.
- MASTER-first: sem migration. Regenerar o pacote, sincronizar
  `delta_version.txt` e `MASTER_RELEASE_VERSION`, rodar `bun run master:check`,
  publicar e autorizar as instalações.

## Fora de escopo

Nenhuma mudança em papéis, banco de dados, telas de operação ou nas demais
funcionalidades do sistema.

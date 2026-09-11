# Corrigir tela branca “Uncaught undefined”

## Diagnóstico confirmado

A rota administrativa faz uma verificação assíncrona em `beforeLoad` e pode redirecionar enquanto o TanStack Router ainda exibe o estado pendente. Essa combinação tem uma condição de corrida conhecida no `MatchInnerImpl`: o roteador pode lançar `undefined`, fora do limite de erro, e remover toda a interface. Isso explica por que uma aba ficou branca enquanto outra abriu normalmente.

## Alterações

1. Remover o redirecionamento assíncrono do `beforeLoad` de `/admin`.
2. Criar um gate no layout administrativo que:
   - consulta a permissão de Super Admin no cliente;
   - mostra carregamento enquanto valida;
   - redireciona sem lançar exceção quando o acesso é negado;
   - mostra uma recuperação visível caso a validação falhe.
3. Preservar a proteção real em todas as funções do servidor; a mudança afeta somente a navegação e evita a tela branca.
4. Melhorar a normalização do erro global para que valores não-`Error`, incluindo `undefined`, produzam um diagnóstico útil caso outra origem semelhante apareça.
5. Adicionar teste de regressão para acesso permitido, negado e falha transitória.
6. Executar typecheck, testes, build e `master:check`; depois sincronizar a versão MASTER-first se houver alteração distribuível.

## Resultado esperado

- `/admin/ambiente` não fica mais em branco durante redirecionamentos ou atualização de sessão.
- Usuários sem permissão continuam bloqueados.
- Super Admins entram normalmente.
- Falhas futuras exibem uma tela recuperável e geram diagnóstico legível.

# Corrigir a falha de provisionamento da unitos-taveira

## O que o erro diz

As duas últimas tentativas de provisionamento pararam sempre no mesmo ponto:

```text
FAIL: verify-installation: 1 verificação(ões) em FAIL:
RLS habilitado em todas as tabelas de public
```

Ou seja: todas as etapas (Supabase, código, deploy, banco, variáveis, cron) rodaram, e
a validação final reprovou porque existe **1 tabela no banco da instalação sem as regras
de acesso ligadas**. Como a validação é o último passo, a instalação é marcada como
"Falhou" mesmo estando praticamente pronta.

## Causa

Essa tabela não é do produto: é uma **tabela auxiliar criada pela própria automação**
para controlar a atualização do banco (registro do que já foi aplicado) e a fila de
comandos fora de ordem. Ela é criada sem regras de acesso e, no caso do registro de
versões, é permanente — por isso a validação passa a reprovar para sempre, em toda nova
tentativa.

Conferi o banco do MASTER: lá não existe nenhuma tabela pública sem regras de acesso,
o que confirma que o problema vem das tabelas auxiliares criadas no destino.

Detalhe adicional visível no histórico: a tentativa de "Atualização" de 18:27 falhou por
outro motivo — **cota diária de publicações da Vercel esgotada (100/dia no plano
gratuito)**. Isso é limite de conta, não defeito; passa sozinho na virada do dia.

## O que será feito

1. **Tabelas auxiliares deixam de reprovar a validação**: ao criá-las, a automação já
   liga as regras de acesso e remove qualquer permissão de leitura externa. Elas passam a
   ser invisíveis pela API pública, como manda a política de segurança.
2. **Auto-reparo antes da validação**: antes de rodar a validação final, a automação
   corrige qualquer tabela auxiliar remanescente de execuções anteriores (é o caso da
   Taveira hoje) e remove a fila de comandos já esvaziada.
3. **Mensagem de erro útil**: quando essa verificação reprovar, o relatório passa a
   dizer **quais** tabelas estão sem regras de acesso, em vez de só a contagem.
4. **Rodar novamente o provisionamento da Taveira** e conferir: validação com todas as
   verificações OK, painel indicando instalação operacional, e o aviso remanescente
   apenas de "criar o primeiro Super Admin em /setup".
5. Se a cota de publicações da Vercel ainda estiver esgotada no momento da execução, a
   etapa de publicação é reportada como aguardando cota (não como falha) e basta repetir
   depois — sem refazer as etapas já concluídas.

## Detalhes técnicos

- `src/lib/installation/automation.server.ts`:
  - na criação de `public._unitos_applied_deltas` e `public._unitos_deferred_sql`,
    acrescentar `alter table ... enable row level security` e
    `revoke all on ... from anon, authenticated` (sem policies → inacessível via Data API,
    acessível pela Management API/serviço).
  - nova rotina idempotente `hardenHelperTables(management)` chamada imediatamente antes
    de `prepareVerificationSql(verifySql)` nas duas rotas (provisionamento e validação
    automática), que liga RLS/revoga grants nas duas tabelas auxiliares se existirem e
    dropa `_unitos_deferred_sql` quando estiver vazia.
- `supabase/install/verify-installation.sql`: na verificação 15, trocar o valor exibido de
  contagem por `string_agg(tablename, ', ')` das tabelas sem `rowsecurity` (mantendo o
  critério PASS = zero).
- `tests/installation-baseline-completeness.unit.test.ts`: casos cobrindo (a) SQL de criação
  das tabelas auxiliares contendo RLS + revoke, (b) `hardenHelperTables` idempotente,
  (c) parser da validação com a linha 15 já em formato de lista de nomes.
- Sem migration no MASTER e sem mudança de RBAC/RLS do produto.

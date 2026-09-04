# Variáveis de ambiente ausentes na Vercel (unitos-taveira)

## O que realmente aconteceu

A instalação `unitos-taveira` não tem nenhuma variável na Vercel porque o provisionamento
**parou antes da etapa que grava as variáveis**. O registro da última operação mostra:

```text
Supabase .............. concluído
Código no GitHub ...... concluído
Deploy conectado ...... concluído (auto-deploy segue ligado, plano Hobby)
Secrets próprios ...... ERRO  -> "set_cron_secret falhou"
Variáveis + publicação  pendente   <- é aqui que as variáveis são criadas
Banco + RLS ........... pendente
... demais etapas ..... pendentes
```

Ou seja: as variáveis **são automáticas** (como no `unitos-teste` do anexo, com Supabase,
`PUBLIC_APP_URL`, `VITE_*`, segredos e credenciais Meta), mas só são gravadas na etapa
"Variáveis + publicação", que nunca foi alcançada.

## Causa da parada

A etapa "Secrets próprios" grava o segredo dos jobs automáticos chamando uma função no banco
da instalação. Essa função só é criada na etapa "Banco + RLS", que roda **depois**. Em bancos
novos, portanto, a função ainda não existe e a etapa falha — sem chance de seguir.

A correção que cria essa função de forma independente antes do uso já está aplicada no código;
falta reordenar/validar o fluxo e rodar novamente para que as variáveis sejam gravadas.

## O que fazer

1. Mover a gravação do segredo de cron para **depois** de o banco estar preparado, mantendo a
   criação idempotente das funções do Vault como rede de segurança. Assim a ordem passa a ser:
   Supabase -> Código -> Deploy conectado -> Banco/RLS/Storage/Seeds -> Segredos -> Variáveis +
   publicação -> Brain -> Cron -> Validação.
2. Garantir que a etapa de variáveis não dependa de um deployment já existente: quando o projeto
   Vercel ainda não tem build, usar o domínio canônico do projeto como URL operacional, gravar as
   variáveis e só então disparar o primeiro build.
3. Tratar como aviso (não erro) a impossibilidade de desligar auto-deploy no plano Hobby — já é o
   comportamento atual, apenas confirmado no fluxo novo.
4. Retomar o provisionamento da `unitos-taveira`. Etapas já concluídas (Supabase, GitHub, vínculo
   Vercel) não são refeitas; a execução segue direto para banco, segredos e variáveis.
5. Conferir na Vercel, ao final, a mesma lista do `unitos-teste`: URLs/chaves do Supabase,
   `PUBLIC_APP_URL`, equivalentes `VITE_`, chave de serviço, segredos gerados por instalação e,
   quando configurado, as credenciais Meta.

## Detalhes técnicos

- `src/lib/installation/automation.server.ts`: mover o bloco `set_cron_secret` para depois de
  `runBaselinePhase`, mantendo `CRON_SECRET_VAULT_HELPERS_SQL` idempotente e o checkpoint de fase
  (`saveStageProgress`) coerente com a nova ordem, para retomadas não regerarem segredos.
- Resolução de URL: complementar `resolveOperationalUrl` com o domínio canônico do projeto Vercel
  quando não houver `targets.production`, evitando bloqueio no primeiro provisionamento.
- Testes: atualizar `tests/installation-automation.unit.test.ts` cobrindo (a) banco preparado antes
  do segredo, (b) variáveis gravadas em projeto sem deployment anterior, (c) retomada sem repetir
  etapas concluídas.

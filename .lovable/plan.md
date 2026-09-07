# Taveira: o que aconteceu e como sair dessa tela

## O que os registros mostram

1. Às 23:24 você pediu **Atualizar**. Ela parou com um bloqueio, e a mensagem foi clara:

```text
BLOCKED: o pacote de código publicado está na versão 1.2.9 e o sistema já está
em 1.3.7. Publique o MASTER e repita a atualização — enviar agora repetiria o
mesmo código.
```

Ou seja: a atualização não podia acontecer porque **o MASTER ainda não foi publicado**. Falta o passo do botão de publicar aqui no MASTER; nada estava errado na Taveira.

2. Às 23:26 você clicou em **Provisionar**. Isso não é o caminho da atualização: é a instalação do zero, com 11 etapas. Ela está rodando agora (etapa 4 de 11, banco, ~48%) e continua viva — o último sinal foi há menos de um minuto. Por isso a tela parece parada há muito tempo: reaplicar o banco inteiro é demorado.

3. Boa notícia: essa execução é segura. As chaves da instalação são reaproveitadas (não são recriadas), os dados existentes não são apagados e as etapas já concluídas são puladas. A validação de 22:53 passou com 30 verificações OK e a instalação segue **saudável**. O único aviso é "primeiro Super Admin ainda não criado", que não bloqueia nada.

## Como resolver

1. **Encerrar a execução atual.** Duas opções, ambas aceitáveis:
   - deixar terminar (não causa dano, só leva tempo); ou
   - clicar em **Cancelar** na barra de progresso — a instalação volta ao estado anterior, saudável, sem perder nada.
   Recomendo cancelar, porque reinstalar não resolve o que você quer.

2. **Publicar o MASTER.** É o passo que estava faltando. Enquanto o código publicado do MASTER estiver em 1.2.9, qualquer atualização da Taveira será bloqueada de propósito.

3. **Autorizar a atualização da Taveira.** Depois de publicar, abrir a Taveira, aba **Versões**, e clicar em **Autorizar atualização**. Aí sim ela recebe todas as novidades (1.3.7).

4. **Confirmar o resultado.** Ao final, a Taveira deve mostrar versão instalada 1.3.7, saudável, e o registro da execução com todas as etapas concluídas.

5. **Facilitar o acerto na próxima vez.** Ajuste pequeno na tela da instalação: quando a instalação já está no ar, "Provisionar" passa a ficar recolhido no menu de ações avançadas, com um aviso de confirmação explicando que é reinstalação, e "Autorizar atualização" fica como a ação em destaque. Quando a atualização estiver bloqueada por falta de publicação, o aviso na tela diz exatamente isso, com o passo a passo, em vez de só "falhou".

## Detalhes técnicos

- Operação `provision` `422036ca` em `running`, etapa `database` (48%), heartbeat ativo — reaproveita `stageProgress` e `ensureInstallationSecrets` (nenhuma chave regerada).
- Operação `update` `1752926e` falhou com `error_kind: blocked`, comparando `repoRelease` (1.2.9) com `MASTER_RELEASE_VERSION` (1.3.7). Comportamento correto; não há bug a corrigir aqui.
- Ajuste de UI apenas em `src/routes/_authenticated/admin.instalacoes.$id.tsx`: mover "Provisionar" para o menu `...` com diálogo de confirmação quando `status` for operacional, destacar "Autorizar atualização" e exibir a dica do bloqueio a partir de `summary`/`error_kind` da última operação.
- Sem migration, sem mudança de RBAC/RLS. Se o ajuste de UI entrar, seguir MASTER-first (regenerar delta, sincronizar `delta_version.txt` + `MASTER_RELEASE_VERSION`, `bun run master:check`).

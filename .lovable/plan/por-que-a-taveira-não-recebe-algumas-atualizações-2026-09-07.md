# Por que a Taveira não recebe algumas atualizações

## O que a auditoria encontrou (verificado)

Histórico real das operações da instalação `unitos-taveira` (tabela de operações do MASTER):

```text
1.2.9  · 4b11ace  → sucesso
1.2.10 · 4b11ace  → sucesso
1.2.12 · 4b11ace  → sucesso
1.3.1  · 4b11ace  → sucesso   (versão fixada hoje: 1.3.1 / 4b11ace)
```

O número da versão avançou quatro vezes, mas o **código enviado foi sempre o
mesmo pacote (`4b11ace`)**. Antes disso, 1.2.5 e 1.2.6 também compartilharam o
mesmo pacote (`52bc054`).

Causa: a atualização monta o código a partir do **repositório do MASTER**, e
esse repositório só avança quando o MASTER é publicado. O banco de dados, ao
contrário, é atualizado com o pacote que está rodando no MASTER naquele
momento. Ou seja, hoje existem duas fontes diferentes:

- banco: sempre a versão nova;
- código: a última versão publicada — que ficou parada.

Pior: quando o código não muda em nada, a operação ainda **termina como
"Atualização aplicada"** e grava na instalação o número de versão novo
(hoje 1.3.2 é o número do sistema, e a Taveira está marcada como 1.3.1 embora
esteja no código de 1.2.9). É por isso que "algumas atualizações não sobem" sem
nenhum erro visível.

Também confirmado: a instalação está saudável, 30 verificações PASS, sem erro
registrado — nada estava travando, só não havia código novo para enviar.

## O que vou corrigir

1. **Conferir a versão antes de enviar.** Antes de publicar, a atualização lê a
   versão que existe de fato no pacote do MASTER. Se ela for menor que a versão
   do sistema, a operação **para** com uma mensagem clara: "O MASTER ainda não
   foi publicado — publique o MASTER e repita a atualização" (com as duas
   versões, a de dentro do pacote e a atual).
2. **Nunca mais dizer que atualizou sem atualizar.** Se nenhum arquivo mudou, a
   operação termina em "Atenção — nada novo para enviar", e a versão fixada na
   instalação passa a ser a versão real do pacote enviado, não o número atual do
   MASTER.
3. **Mostrar isso no painel.** Na tela da instalação e na lista, além da versão
   do sistema, aparece a versão realmente publicada no MASTER e um aviso
   "MASTER não publicado" quando as duas divergem — assim o problema fica
   visível antes de tentar atualizar.
4. **Corrigir o registro da Taveira.** A versão fixada hoje (1.3.1) não
   corresponde ao código real; ela volta a mostrar a versão do pacote que está
   realmente instalado, para o painel deixar de mentir.
5. **Subir tudo para o MASTER.** Regenerar o pacote, alinhar versão do pacote e
   versão do sistema (1.3.3), incluir as verificações novas, rodar a checagem
   completa (`bun run master:check`), typecheck e build.

Depois disso, a sequência correta para a Taveira receber tudo (Mídia paga com
relatório de anúncios, rota rápida de pauta, calendário, projetos, analytics,
mensagens) é: **publicar o MASTER → autorizar "Atualizar" na instalação**. Com a
correção, se o passo de publicar faltar, o sistema avisa em vez de fingir
sucesso.

## Detalhes técnicos

- `runAutomatedUpdate` (`src/lib/installation/automation.server.ts`): após
  resolver `targetSha`, ler `supabase/baseline-snapshot/tools/delta_version.txt`
  do repo MASTER naquele SHA via GitHub contents API; comparar com
  `MASTER_RELEASE_VERSION`; se `<`, `fail("BLOCKED", ...)` com as duas versões.
- `publishSnapshot` já devolve `changed`; propagar esse valor: `changed === 0`
  → finalizar com `warnings: true` e não gravar `pinned_release` novo.
- `pinned_release` passa a receber a versão lida do commit publicado.
- `getMasterVersionFn` (`manager.functions.ts`) devolve também `repoRelease`;
  `admin.instalacoes.$id.tsx` e `admin.installations.tsx` exibem o aviso.
- Teste novo em `tests/` cobrindo: bloqueio por MASTER não publicado e
  `changed === 0` sem avanço de versão.
- MASTER-first: `build_delta.py`, `delta_version.txt` + `MASTER_RELEASE_VERSION`
  = 1.3.3, `verify-installation.sql` e `bun run master:check`.

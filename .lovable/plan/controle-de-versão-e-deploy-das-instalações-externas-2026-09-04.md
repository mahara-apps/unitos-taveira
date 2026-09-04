# Controle de versão e deploy das instalações externas

## Problema confirmado

Todos os projetos de deploy (MASTER e instalações como `unitos-teste`) estão ligados ao mesmo repositório de código (`mahara-apps/unitos-master`, branch `main`). Como o provedor de deploy dispara build automático a cada commit nessa branch, qualquer publicação no MASTER publica também nas instalações externas — exatamente o que aparece nos prints (mesmo commit `d546166` construindo nos dois projetos ao mesmo tempo).

Hoje o deploy da instalação também usa sempre a ponta da branch (`ref: main`), então mesmo o botão "Puxar atualização" não representa uma versão fixa.

## O que muda

1. **Instalação externa deixa de atualizar sozinha.** No momento em que a instalação é provisionada (e também quando o painel toca nela), o projeto de deploy da instalação passa a ter o build automático da branch desligado. Só o MASTER continua publicando automaticamente a cada commit.

2. **Cada instalação passa a ter uma versão fixada.** Guardamos qual ponto exato do código está publicado naquela instalação (identificador do commit + número da release). A publicação passa a usar esse ponto fixo, não "o que estiver na branch agora".

3. **Atualização somente autorizada.** No detalhe da instalação, o Super Admin vê:
   - Versão publicada na instalação (release + commit curto + data)
   - Versão disponível no MASTER (release + commit curto da branch)
   - Botão "Autorizar atualização" (aparece só quando há diferença) que fixa a nova versão e executa a atualização já existente, com progresso, retry e histórico.
   Sem essa autorização, nada é publicado na instalação.

4. **Histórico de versionamento.** Cada operação de atualização registra a versão de origem e de destino, quem autorizou e quando, na lista de operações que já existe.

## Detalhes técnicos

- Migração: adicionar em `public.installations` as colunas `pinned_commit_sha`, `pinned_release`, `pinned_at`, `pinned_by` (RLS existente de Super Admin preservada).
- `automation.server.ts` / `createDeployClient`:
  - novo método `setAutoDeploy(enabled)` — `PATCH /v9/projects/{id}` com `{ git: { deploymentEnabled: { main: false } } }` para instalações externas; chamado após o link do repositório em `deployLatestCode` e no provisionamento.
  - novo método `latestCommit()` — lê o commit atual da branch de produção do repositório do MASTER, usado para exibir "versão disponível".
  - `deployLatestCode` passa a receber um `sha` obrigatório e usar `gitSource: { type, repoId, ref: sha }`; sem `sha` fixado, usa o commit atual e o grava como fixado.
  - a proteção anti-MASTER e o fallback manual continuam iguais.
- `manager.functions.ts`: `runAutomatedUpdate` recebe o `sha` autorizado, grava `pinned_*` e `current_version`, e registra `fromVersion`/`toVersion` em `installation_operations.detail`. Guard `super_admin` mantido.
- UI `Administração → Instalações → detalhe`: card "Versão e atualizações" com versão publicada, versão disponível, diferença e botão de autorização; lock/polling/cancelamento atuais reaproveitados.
- Testes: build automático desligado para instalação externa e mantido no MASTER; deploy usando commit fixado em vez da branch; atualização sem autorização bloqueada; registro de versão anterior/nova no histórico.

## Fora de escopo

Não altera OAuth/Meta, RLS de outros módulos, schema do app, credenciais, nem o fluxo de deploy do próprio MASTER.

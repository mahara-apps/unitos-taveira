# Onde a Taveira está agora e como voltar ao caminho certo

## Mapa da situação (lido agora no banco do MASTER)

```text
23:24  Atualizar     -> BLOQUEADA: "o MASTER ainda não foi publicado"
23:26  Provisionar   -> reinstalação começou (não era o caminho)
23:47  Cancelar      -> parou dentro da etapa de banco (005_auth_trigger)

Estado atual: status = erro anterior | saúde = saudável
Versão instalada: 1.2.9 (commit 4b11ace)   Sistema/MASTER: 1.3.7
```

Você já executou a validação depois do cancelamento: ela terminou com **30 verificações aprovadas**. Site no ar (HTTP 200), banco, Supabase, storage, cron, chaves, código e workspace estão OK. O único aviso é "primeiro Super Admin não criado", que não bloqueia a atualização.

## O que isso significa, em palavras simples

- A atualização nunca foi aplicada. Ela foi barrada de propósito, porque o código do MASTER ainda não foi publicado: o pacote publicado está em 1.2.9 e o sistema aqui já está em 1.3.7. Enviar assim repetiria o código antigo.
- O "Provisionar" que você clicou é reinstalação, não atualização. Ele não apaga dados nem troca as chaves da instalação, mas não resolve o que você queria.
- O cancelamento interrompeu a reinstalação, mas a validação posterior confirmou que a Taveira continua íntegra e saudável. O `status=error` remanescente é apenas o registro da última atualização bloqueada; não representa a saúde atual.

## Plano

1. **Não provisionar novamente.** A validação já passou com 30 verificações OK; a Taveira está pronta para receber somente a atualização.

2. **Publicar o MASTER daqui.** Antes da publicação, conferir segurança. O pacote 1.3.7 está alinhado, o build está aprovado e o código já está preparado; a publicação é o passo que falta desde 23:24.

3. **Executar a atualização da Taveira daqui.** Depois que o repositório do MASTER confirmar a release 1.3.7, disparar a atualização automática da Taveira, acompanhar código, banco e publicação até o estado final — sem depender de você clicar novamente.

4. **Conferir o fim.** Esperado: versão instalada 1.3.7, saudável, execução com todas as etapas concluídas, e como único aviso "criar o primeiro Super Admin em /setup".

5. **Evitar o mesmo tropeço na próxima vez** (ajuste pequeno de tela, sem tocar em regra de negócio):
   - "Provisionar" sai do destaque quando a instalação já está no ar: vai para o menu de ações avançadas, com confirmação dizendo em texto claro que é reinstalação.
   - "Autorizar atualização" passa a ser a ação em evidência quando há versão nova.
   - Quando uma operação é interrompida ou bloqueada, o aviso na tela explica o motivo e o próximo passo, em vez de só "Falhou".

## Detalhes técnicos

- `installations` (unitos-taveira): `status=error` (última operação bloqueada), `health=healthy`, todos os checks obrigatórios OK, `current_version=pinned_release=1.2.9`, `pinned_commit_sha=4b11ace`.
- Validação `187353e2` concluída com sucesso às 23:47:48: 30 verificações PASS. Atualização mais recente `f051eb86` bloqueada corretamente porque `repoRelease=1.2.9` ainda difere de `MASTER_RELEASE_VERSION=1.3.7`.
- MASTER preparado: `MASTER_RELEASE_VERSION=1.3.7`, `delta_version=1.3.7`, SHA do pacote `2444dbe…56ab53`; builds recentes OK.
- Reprovisionar é idempotente: `stageProgress` retoma etapas e `ensureInstallationSecrets` reaproveita chaves (nenhum token cifrado é invalidado).
- Passo 1 usa `runAutomatedValidation` (`verify-installation.sql`), que agora não promove versão — apenas recalcula `health`/`status` sobre a release fixada.
- Ajuste de UI restrito a `src/routes/_authenticated/admin.instalacoes.$id.tsx` e ao cartão da lista: hierarquia de ações e leitura de `summary`/`error_kind` da última operação para o aviso. Sem migration, sem mudança de RBAC/RLS. Se esse ajuste entrar, seguir MASTER-first (regenerar delta, sincronizar `delta_version.txt` + `MASTER_RELEASE_VERSION`, `bun run master:check`).

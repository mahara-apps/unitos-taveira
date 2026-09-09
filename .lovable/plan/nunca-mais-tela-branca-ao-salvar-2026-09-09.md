# Nunca mais tela branca ao salvar

## O que foi verificado

Auditoria de leitura em todas as telas internas mostrou dois pontos frágeis reais:

1. **Tela de cliente sem rede de proteção para erro.** A tela `/customers/$customerId` tem
   um estado de carregamento próprio (esqueleto), mas não tem tratamento de erro próprio.
   Se a leitura do briefing falhar — cenário provável em cliente recém-criado, cujos dados
   ainda estão sendo gravados — o erro sobe até o topo do aplicativo e a tela de erro do topo
   **substitui a página inteira, inclusive o menu lateral e a barra superior**. Se essa tela
   de topo também não conseguir pintar, o resultado percebido é exatamente a tela em branco
   que você viu, e recarregar com Ctrl+Shift+R resolve.
2. **Momento de branco por decisão antiga.** A camada que protege as telas internas está
   configurada hoje para não desenhar nada enquanto valida a sessão. Em navegação lenta ou
   logo após recarregar a página, isso é literalmente uma tela vazia.

Ainda não está confirmado qual erro exato dispara no caso do cliente novo, então o primeiro
passo do trabalho é reproduzir e capturar o erro real; o resto vale mesmo que ele mude.

## O que será feito

**1. Confirmar a causa**
Reproduzir o fluxo criar cliente → preencher briefing → salvar, capturando o erro exato
(inclusive verificando se a leitura do briefing falha quando o cliente ainda não tem dados
salvos). Se ela falhar, passar a tratar cliente sem briefing como estado vazio normal, não
como erro.

**2. Menu e topo nunca desaparecem**
Criar uma tela de erro única, usada por todas as telas internas, que aparece **dentro da
área de conteúdo**, com o menu lateral e a barra superior intactos. A tela mostra uma
mensagem em linguagem simples e um botão "Tentar de novo". A tela de erro do topo passa a
ser só o último recurso.

**3. Carregando central padrão**
Um indicador de carregamento central e reaproveitável para as telas internas, no lugar da
tela vazia atual, também mantendo menu e topo visíveis. Aplicado na tela do cliente e nas
demais telas internas que hoje não têm indicador próprio.

**4. Recuperação automática, uma vez**
Se uma tela quebrar, o sistema tenta se recuperar sozinho uma única vez, sem o usuário fazer
nada. Se falhar de novo, mostra o aviso amigável com "Tentar de novo" — nunca fica em branco
nem tenta em loop.

**5. Feedback no salvamento do briefing**
Durante o salvamento, o botão fica em estado "Salvando…" e a tela não fica sem resposta;
ao concluir, a atualização dos dados acontece em segundo plano, sem apagar o que está na tela.

## Detalhes técnicos

- `errorComponent` compartilhado em todas as rotas de `src/routes/_authenticated/*`,
  renderizado abaixo do `AppShell`, e `ErrorBoundary` próprio em volta da árvore do cliente
  em `customers.$customerId.tsx` (que hoje só tem `<Suspense>`).
- Substituir `pendingComponent: () => null` em `_authenticated/route.tsx` por um fallback que
  preserva sidebar/header e mostra o indicador central.
- Auto-recuperação: uma única `router.invalidate()`/reset por boundary, com marcador para não
  repetir; depois disso, UI de erro com retry manual.
- Revisar `customerCoreQuery`/`loadCanonicalBriefing` para retornar estado vazio em vez de
  lançar quando o cliente é novo. `enabled` é ignorado por `useSuspenseQuery` — manter a
  validação de escopo no componente-pai.
- Sem migração de banco. Sem mudança de permissões, RLS, rotas ou regras de negócio.
- MASTER-first: regenerar o pacote, sincronizar `delta_version.txt` e `MASTER_RELEASE_VERSION`
  (1.3.19), cobrir em `verify-installation.sql` se aplicável e rodar `bun run master:check`.

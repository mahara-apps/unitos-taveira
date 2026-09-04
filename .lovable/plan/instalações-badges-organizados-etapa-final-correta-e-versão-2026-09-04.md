# Instalações: badges organizados, etapa final correta e versão v1.0.0

## O que muda na tela

### 1. Menos badges, mais lista com marcações
Hoje o quadro verde "Instalação pronta e operacional" espalha até 8 cápsulas na mesma linha (Validada, Super Admin, e uma por item opcional). Passa a ser:

- No topo, ao lado do nome: apenas **um** selo de situação geral (OPERACIONAL / ATENÇÃO / FALHA) + saúde. O selo de "Atualizada" sai do topo e vira parte do bloco de versão, que já diz a mesma coisa.
- No quadro de situação, uma **lista de itens com marcação** em duas colunas, em vez de cápsulas soltas:

```text
Pronta e operacional
  Validada           03/09/2026 16:42
  Super Admin        criado
  Configurações opcionais            2 de 6 configuradas
     Domínio definitivo    pendente
     Meta                  pendente
     ...
```

- Os opcionais ficam recolhidos atrás de um resumo ("2 de 6 configuradas") que o usuário expande quando quiser; nunca mais 6 cápsulas na horizontal.
- Cada linha usa marca de conferido, pendente ou falha, com o texto do estado à direita — sem depender de cor.
- No quadro amarelo (ainda não pronta), mesma lista: obrigatórios pendentes/com falha em linhas, não em cápsulas.

### 2. Etapa "Pronto" fica verde
Hoje a última etapa da trilha (Cadastrar → Provisionar → Validar → Configurar → Pronto) nunca fica verde: quando a instalação chega ao fim, a etapa atual é "Pronto" e o estilo de "etapa atual" é azul. Passa a existir um estado concluído: quando a instalação está pronta e operacional, a etapa "Pronto" aparece marcada em verde com o sinal de conferido, tanto na lista de instalações quanto no detalhe.

### 3. Versão como v1.0.0 e datas em pt-BR
- A versão distribuída pelo MASTER passa a ser **1.0.0** e é exibida como **v1.0.0** em todos os lugares (lista, detalhe, aba de versões, histórico).
- Instalações que ainda registram o número antigo passam a aparecer como "atualização disponível" até a próxima validação — comportamento esperado da troca de numeração, sem nenhuma ação obrigatória no destino.
- Datas e horas passam a sair como **03/09/2026 16:42**, sempre no horário de Brasília, em toda a tela de instalações (validação, provisionamento, histórico, saúde, fixação de versão).

## Detalhes técnicos

- `src/components/installations/installation-visuals.tsx`
  - `LifecycleSteps` e `LifecycleTrail` recebem `complete?: boolean`; com `complete` a última etapa usa o tom `health-good` e ícone de conferido, em vez do tom `primary` de "etapa atual".
  - Novos primitives: `CheckList` / `CheckRow` (linha com ícone de estado, rótulo e valor à direita) e `OptionalSummary` (contador + `Collapsible` com as linhas dos opcionais).
  - `VersionPair` passa a formatar via novo helper `formatVersion` (prefixo `v`), mantendo `font-mono`.
  - Novo helper de data `formatDateTimeBr` em `src/lib/timezone.ts` (`pt-BR`, `timeZone: America/Sao_Paulo`, dia/mês/ano hora:minuto) e `formatDateBr`.
- `src/routes/_authenticated/admin.instalacoes.$id.tsx`
  - Quadro de veredito reescrito com `CheckList` + `OptionalSummary`; remove o `map` de `StateBadge` por opcional pendente.
  - Header: remove o `StatusBadge` duplicado quando ele repete o selo geral; mantém situação geral + saúde.
  - Todas as chamadas `new Date(x).toLocaleString("pt-BR")` trocadas por `formatDateTimeBr(x)`.
  - `LifecycleSteps` recebe `complete={readiness.ready}`.
- `src/components/installations/installation-card.tsx` e `admin.instalacoes.index.tsx`: mesma formatação de data/versão e `complete` na trilha.
- `src/lib/installation/manager-contract.ts`: `MASTER_RELEASE_VERSION = "1.0.0"`; comparação de versão permanece por igualdade de string (nenhuma lógica nova de ordenação).
- Sem mudança em RBAC, RLS, chamadas server-side, contratos de prontidão, polling ou banco de dados. Os testes de instalações existentes são atualizados apenas onde afirmam o texto da versão.

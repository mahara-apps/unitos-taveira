# Refatoração da tela de Instalações (UI/UX)

Refatoração completa da apresentação das duas telas de Instalações — a lista e o detalhe — sem tocar em nenhuma regra de negócio, chamada de servidor, permissão ou dado. Todas as funções, mutações, polling e estados atuais continuam iguais; muda a organização visual, a hierarquia e a navegação.

## Lista de instalações

- Cabeçalho enxuto: título, contagem, versão do MASTER como etiqueta discreta, e um único botão primário "Nova instalação". A frase longa "1 instalação = 1 aplicação..." vira texto auxiliar de uma linha, e a trilha de ciclo de vida sai do cabeçalho (ela não representa nada quando exibida solta).
- Indicadores no topo mantidos com PageKpi/PageKpiGrid, com rótulos mais diretos: Total, Em execução, Atualização disponível, Atenção.
- Lista vira uma grade de cartões de instalação, cada um com:
  - nome, etiqueta de status e etiqueta de saúde na mesma linha (com truncamento seguro em telas estreitas);
  - domínio clicável/copiável em texto secundário;
  - bloco de versões lado a lado: "instalada" x "disponível", com indicador visual quando estão diferentes ("atualização disponível") ou iguais ("em dia");
  - trilha do ciclo de vida compacta, em forma de pontos com rótulo da etapa atual, em vez de cinco cápsulas repetidas por linha;
  - data da última validação em texto discreto;
  - seta/ação "Abrir" alinhada à direita.
- Barra de utilidades: busca por nome/domínio e filtro rápido por estado (todas / em execução / atualização / atenção), aplicados no cliente sobre a lista já carregada.
- Estados de carregamento com esqueletos no lugar do texto "Carregando…", e estado vazio com chamada para cadastrar a primeira instalação.

## Detalhe da instalação

Hoje são nove cartões empilhados numa coluna única, exigindo rolagem longa. Nova estrutura:

1. **Cabeçalho fixo de identidade**: voltar, nome, etiquetas (pronta/status/saúde), domínio, e as ações agrupadas — uma ação primária contextual (Provisionar, ou Validar quando já provisionada, ou Autorizar atualização quando há versão nova) e as demais recolhidas em um menu "Mais ações" (Editar dados, Reavaliar saúde, ações manuais). Isso remove a fileira de quatro a cinco botões concorrentes.
2. **Faixa de conclusão** (pronta / não confirmada) mantida, porém mais curta: uma linha de veredito e os pendentes como etiquetas, não como parágrafos.
3. **Abas** para separar o que hoje é rolagem: `Visão geral`, `Versões`, `Saúde`, `Execuções`.
   - Visão geral: resumo em grade de dados (domínio, Supabase, ref, repositório, deploy, última validação) + núcleo da instalação + configuração opcional.
   - Versões: versão publicada, versão disponível no MASTER, autorizado em, e o botão de autorizar atualização com o aviso de que a instalação não publica sozinha.
   - Saúde: saúde medida pelo MASTER e o botão de reavaliar.
   - Execuções: progresso da operação ativa (barra, etapa atual, falhas), validação mais recente e histórico paginado.
4. **Progresso sempre visível**: quando houver operação em andamento, uma faixa fina de progresso aparece logo abaixo do cabeçalho em qualquer aba, com etapa atual e ações de reiniciar/cancelar.
5. **Padronização visual**: espaçamentos consistentes nos cartões, rótulos em caixa alta pequena para dados, valores em fonte mono só onde é identificador técnico, etiquetas de estado com ícone (ok, atenção, erro, pendente) para não depender só de cor.

## Detalhes técnicos

- Arquivos alterados: `src/routes/_authenticated/admin.instalacoes.index.tsx` e `src/routes/_authenticated/admin.instalacoes.$id.tsx`.
- Novos componentes de apresentação em `src/components/installations/`: `installation-card.tsx`, `lifecycle-trail.tsx`, `state-badge.tsx`, `version-pair.tsx`, `data-grid.tsx`, `operation-progress.tsx`, `operations-history.tsx`. Os cartões do detalhe migram para esses componentes, reduzindo o arquivo de rota.
- `STATUS_TONE` e `lifecycleIndex` saem da rota de lista para o módulo compartilhado de componentes (a rota de detalhe hoje importa da rota de lista — acoplamento que será removido).
- Abas com `@/components/ui/tabs`, esqueletos com `@/components/ui/skeleton`, menu de ações com `@/components/ui/dropdown-menu`, tooltips de motivo com `@/components/ui/tooltip`.
- KPIs seguem `PageKpi`/`PageKpiGrid` conforme o design system.
- Nenhuma alteração em `manager.functions.ts`, `manager-contract.ts`, `readiness-contract.ts`, migrations ou RBAC. Nenhum novo dado é buscado; toda informação exibida já vem das consultas atuais.
- Busca/filtro/abas são estado local; nada é persistido no servidor.
- Verificação: typecheck e build limpos, e conferência visual da lista e do detalhe (incluindo estado com operação em andamento).

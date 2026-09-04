# Briefing: análise da IA não aparece nos campos + modal do onboarding desalinhado

## O que está acontecendo (causa confirmada no código)

A importação com IA salvou os dados corretamente — é por isso que, ao subir um novo documento, a comparação mostrava "valor anterior" já preenchido. O problema está só na tela: o formulário do briefing é montado **uma única vez**, na primeira vez que os dados chegam, e nunca é remontado depois.

Em `src/components/brand-hub/briefing-workspace.tsx` (linhas 275-278) o formulário só é preenchido quando ainda está vazio (`if (hubQ.data && !form)`). O modal de importação até avisa a tela para recarregar os dados (`invalidateQueries(["brand-hub", ...])`), os dados novos chegam, mas o formulário continua exibindo a versão antiga que já estava em tela. Recarregar a página resolve — o que explica a impressão de "cache".

O mesmo acontece depois de "Gerar estratégia" com IA e de qualquer alteração feita fora do formulário.

## Correção 1 — refletir o resultado da IA na hora

- Sincronizar o formulário sempre que os dados do briefing forem recarregados, e não apenas na primeira carga: usar a data de atualização do registro (`updated_at`) como marcador de versão e remontar o formulário quando ela mudar.
- Proteger o trabalho em andamento: se houver edições não salvas no formulário, avisar que a IA trouxe novos dados e oferecer "Atualizar campos" em vez de sobrescrever silenciosamente.
- Ao aplicar a importação, além de recarregar os dados, atualizar também a data de "salvo em" e a barra de completude.
- Fazer o mesmo tratamento na tela de Onboarding Rápido, que monta o formulário pelo mesmo caminho.

## Correção 2 — modal de importação dentro do Onboarding Rápido

Nesse contexto o conteúdo é embutido dentro do modal do onboarding (modo `embedded`, linhas 815-829), sem a estrutura de cabeçalho/corpo/rodapé que ele tem quando abre sozinho. Resultado: espaçamentos inconsistentes, duas colunas apertadas e botões colados no conteúdo.

Ajustes, só de apresentação:

- Área de rolagem própria com altura máxima, para o conteúdo não empurrar o modal do onboarding.
- Rodapé de ações fixo na base, com separação e respiro corretos.
- Coluna única quando o espaço é estreito (o modo embutido nunca é largo o bastante para duas colunas), mantendo duas colunas apenas na versão em modal cheio.
- Padronizar padding, espaçamento entre blocos e tamanho dos títulos com o restante do briefing; remover o indicador de etapas duplicado no topo.

## Escopo técnico

- `src/components/brand-hub/briefing-workspace.tsx` — sincronização do formulário por versão dos dados + aviso de alterações não salvas.
- `src/components/brand-hub/briefing-import-dialog.tsx` — layout do modo `embedded` (apenas visual, sem tocar em upload, análise, revisão ou aplicação).
- `src/components/brand-hub/quick-onboarding-wizard.tsx` — mesma sincronização e contêiner do bloco embutido.
- Teste de regressão garantindo que, ao chegar uma versão mais nova do briefing, os campos exibidos passam a mostrar o valor novo.

Nada muda no backend da importação, nos prompts da IA, nas permissões ou nos dados. A instalação da Taveira não precisa de ajuste de banco: os dados já estão lá e passam a aparecer com a correção da tela.

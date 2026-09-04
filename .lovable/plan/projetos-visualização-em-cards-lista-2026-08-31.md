# Projetos: visualização em cards + lista

Mudança apenas de interface em `/projects`. Nenhuma alteração de dados, regra de negócio, RBAC ou banco.

## O que muda

1. **Duas visualizações com alternador**
   - Botão segmentado no topo da barra de filtros: **Cards** | **Lista**.
   - **Cards é o padrão de abertura.** A escolha do usuário é lembrada (persistida localmente e refletida na URL via `?view=cards|list`), então voltar à tela mantém a última visão.
   - A lista atual (tabela com ordenação) permanece exatamente como está, sem perdas.

2. **Cards minimalistas e compactos**
   - Grid responsivo: 1 coluna no mobile, 2 no tablet, 3–4 no desktop.
   - Altura enxuta e uniforme, sem card gigante. Conteúdo de cada card:
     - faixa/ponto de cor + nome do projeto (1 linha, truncado com tooltip);
     - cliente (nome com bolinha da cor do cliente, truncado);
     - badge de status + badge de pauta (quando existir);
     - período/entrega em texto curto (ex. "Entrega 12 set");
     - barra de progresso fina com `publicadas/total` em números tabulares.
   - Todo texto cabe dentro do card: `truncate`/`line-clamp`, sem quebra de layout com nomes longos.
   - Card inteiro clicável, mesmo destino da linha da lista.

3. **Cor como leitura visual**
   - Seletor "Colorir por": **Projeto** (cor já salva do projeto, padrão), **Status** e **Cliente**.
   - A cor aparece como faixa lateral/superior sutil no card + ponto de cor, nunca como fundo saturado.
   - Paleta de status usa os tokens semânticos já existentes na tela (planejamento, ativa, em execução, pausada, concluída, arquivada).
   - Não há tags de projeto hoje no banco; por isso "colorir por tag" fica fora deste escopo (pode entrar depois, com um campo novo).

4. **Filtros e ordenação compartilhados**
   - Mesma barra de filtros (busca, status, responsável, cliente) e mesmo contador de resultados valem para as duas visões.
   - Em Cards, a ordenação vira um seletor compacto ("Entrega mais próxima", "Nome", "Cliente", "Status", "Progresso") reaproveitando a mesma lógica da tabela.

5. **Estados**
   - Skeleton de cards (grid de placeholders compactos) para carregamento em Cards.
   - Estado vazio e erro iguais aos atuais, apenas adaptados ao formato.

## Detalhes técnicos

- Arquivo principal: `src/routes/_authenticated/projects.index.tsx`.
- Novo componente apresentacional `src/components/projects/project-card.tsx` (props derivadas de `listProjects` + `ProjectStats`), sem query própria.
- `view` e `colorBy` entram no `validateSearch` da rota (`z.enum(...).catch("cards")` / `.catch("project")`), com persistência em `localStorage` para o padrão de abertura.
- `rows`/`useMemo` de filtro e ordenação passam a ser compartilhados entre tabela e grid; nenhuma mudança nas chamadas a `listProjects`.
- Cores por status reutilizam `STATUS_META` já definido no arquivo; cores em CSS via `style` apenas para a cor livre do projeto/cliente (dado do banco), o resto em tokens do design system.
- KPIs no topo permanecem como estão.

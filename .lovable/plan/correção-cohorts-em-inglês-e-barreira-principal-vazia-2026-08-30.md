# Correção: cohorts em inglês e "Barreira principal" vazia

## 1. Cohorts ainda em inglês

O que foi verificado no código: o prompt de cohorts já recebe a diretriz de idioma, mas ele continua dizendo apenas "use EXATAMENTE as chaves em inglês", sem exigir que **nomes de cohort e títulos** também sejam em português. É exatamente por isso que os valores voltam como "Corporate Elegance Seekers", "Startup Trailblazers", "Busy Mom Essentials" — o modelo trata o nome do cohort como rótulo/nome próprio e mantém em inglês, e o mesmo acontece nos textos de comportamento/estratégia gerados na mesma resposta.

Correção:
1. Reforçar a diretriz nos prompts das etapas de estratégia: além de "valores em pt-BR", explicitar que **nome/rótulo de cohort, título de persona e frases de exemplo são conteúdo e devem estar em português**; a exceção continua sendo marca do cliente, nomes de pessoas reais, hashtags e termos técnicos consagrados (feed, reels, briefing).
2. Adicionar uma verificação pós-resposta simples: se os valores textuais da etapa vierem predominantemente em inglês, a etapa faz **uma** nova tentativa com a instrução de idioma reforçada, antes de aceitar. Nada em inglês é salvo silenciosamente e nada incompleto é persistido.
3. Cobrir isso com teste de regressão junto ao teste de idioma já existente (a etapa cohorts precisa exigir português também nos nomes).

Importante: o conteúdo em inglês **já salvo** não é traduzido automaticamente nem apagado. Depois da correção, basta regerar a Estratégia do cliente para que voice, personas, cohorts e SWOT venham em português.

## 2. "Barreira principal" sem conteúdo em Personas & Público IA

Causa confirmada: o card lê o campo `objecao_dominante` (com fallback em `dor_principal`) da persona, mas a etapa de personas do pipeline gera `objecoes_comuns` (lista) e `dores` (lista) — nenhum dos dois nomes está na lista de sinônimos aceitos pelo painel. Resultado: o card fica com "—" mesmo com as objeções geradas corretamente.

Correção: aceitar os nomes que o pipeline realmente produz — usar o primeiro item de `objecoes_comuns` (e de `dores` como fallback) quando não houver campo singular. Isso vale tanto para o card "Barreira principal" quanto para a exibição da objeção dentro de cada persona, sem alterar o schema de geração nem os dados já salvos.

## Fora de escopo

Sem alterações em RBAC/RLS/auth, migrations, schema do banco, tenants/workspaces ou Instalação × Workspace. Sem tradução automática de dados já persistidos.

## Validação

Testes de idioma e de coerção do pipeline, teste do mapeamento de personas do painel, suíte completa, typecheck e build. Depois, regerar a estratégia de um cliente e confirmar: cohorts com nomes e textos em português e "Barreira principal" preenchida.

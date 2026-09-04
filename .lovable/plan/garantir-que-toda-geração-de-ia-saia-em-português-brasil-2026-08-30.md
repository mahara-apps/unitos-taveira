# Garantir que toda geração de IA saia em português (Brasil)

## Por que saiu em inglês

Os prompts das etapas de estratégia (`Estratégia IA`, Voice Card, Personas, Cohorts, SWOT)
instruem o modelo a usar **os nomes dos campos em inglês** — o que é correto, pois o schema
salvo no banco usa essas chaves — mas **nunca dizem em que idioma o conteúdo deve ser
escrito**. Exemplo real do prompt atual da etapa de voz:

```text
Use EXATAMENTE as chaves do schema em inglês: voice_card.brand_personality, ...
Não traduza nomes de campos. Responda SOMENTE JSON.
```

Sem instrução de idioma, o modelo tende a seguir o idioma das chaves e devolve valores em
inglês — exatamente o que aparece na tela: chips "Refined / Warm / Conversational" e frases
como "Elevate your day with effortless elegance."

O problema é sistêmico: alguns fluxos já pedem português explicitamente (pauta mensal,
plano de mídia, chat do Brain, resumo do dashboard), mas outros não — estratégia do cliente,
análise/importação de briefing, agentes de post, templates de projeto.

## O que será feito

1. **Diretriz de idioma única e obrigatória** — um texto padrão reutilizável
   ("Escreva TODO o conteúdo em português do Brasil; nomes de campos permanecem em inglês;
   preserve nomes próprios, marcas e termos técnicos consagrados como estão").
2. **Aplicar em todos os prompts de geração** que hoje não têm instrução de idioma:
   etapas do pipeline de estratégia (briefing, voz, personas, cohorts, SWOT), análise e
   importação de briefing por IA, agentes de post, agentes gerais e templates de projeto.
3. **Regressão automatizada** para impedir reincidência: um teste que varre os prompts de
   geração e falha se algum não incluir a diretriz de idioma — assim, um prompt novo sem
   português quebra a suíte antes de chegar à produção.
4. **Conteúdo em inglês já salvo**: nada é apagado. Basta usar "gerar novamente" na
   Estratégia IA do cliente para substituir o conteúdo ativo pela versão em português; o
   histórico/versionamento existente é preservado.

## Fora de escopo

- RBAC, RLS, autenticação, tenants/workspaces, instalação, migrations e schema.
- Renomear chaves de campos no banco ou na UI (continuam em inglês por contrato).
- Tradução automática de conteúdo já persistido.

## Detalhes técnicos

- Novo constante compartilhado (ex. `src/lib/ai-language.ts`) com a diretriz pt-BR,
  concatenada aos `system` prompts.
- Arquivos a ajustar: `src/routes/api/jobs/customer-pipeline.ts` (objeto `P`),
  `src/lib/briefing-ai-executor.server.ts`, `src/routes/api/jobs/analyze-briefing-text.ts`,
  `src/routes/api/jobs/analyze-document.ts`, `src/lib/post-agents.server.ts`,
  `src/lib/agents.functions.ts`, `src/lib/project-templates.functions.ts`.
- Novo teste `tests/ai-language.test.ts` verificando a presença da diretriz nos prompts.
- Validação: `npx tsgo --noEmit`, suíte completa e build.

## Status do ajuste anterior (cohorts)

A correção da etapa "Construindo cohorts" já foi aplicada e validada: normalização
tolerante (lista/objeto/aliases PT-BR), uma retentativa em output inesperado e log de
diagnóstico sem conteúdo sensível. Suíte completa: 679 testes aprovados. O build final será
executado junto com este ajuste de idioma.

# Plano de mídia paga com entrevista guiada + agente especialista

## O que muda para o usuário

Hoje o plano de mídia é gerado por um formulário técnico (orçamento, contexto e três controles de funil). Quem não é de mídia não sabe responder. Vamos trocar por uma **entrevista guiada em formato quiz**, com perguntas em linguagem do dia a dia e respostas em cartões clicáveis (com ícone e exemplo em cada opção). Ao final, um agente de IA especialista em Meta Ads e Google Ads monta o plano pronto para execução.

A entrevista é **adaptativa**: começa com 6 perguntas essenciais e abre perguntas extras só quando faz diferença (loja física → raio de atendimento; e-commerce → ticket médio e catálogo; serviço → agendamento e prazo de fechamento; já anuncia → o que já funcionou).

Exemplo de tela:

```text
┌──────────────────────────────────────────────┐
│  Passo 3 de 9        ▓▓▓▓▓▓░░░░░░  33%       │
│                                              │
│  O que você mais precisa nos próximos 30 dias?│
│  ┌────────────┐ ┌────────────┐ ┌───────────┐ │
│  │ 🛒 Vender   │ │ 📞 Receber │ │ 🚶 Levar  │ │
│  │ pelo site   │ │ contatos   │ │ gente à   │ │
│  │             │ │ (WhatsApp) │ │ loja      │ │
│  └────────────┘ └────────────┘ └───────────┘ │
│  ┌────────────┐ ┌────────────┐               │
│  │ 👀 Ser mais │ │ 🔁 Voltar  │               │
│  │ conhecido   │ │ quem já viu│               │
│  └────────────┘ └────────────┘               │
│                                              │
│  Voltar                          Continuar → │
└──────────────────────────────────────────────┘
```

Perguntas previstas (curtas, uma por tela, sem jargão): o que o cliente vende; o resultado desejado em 30 dias; quem precisa ver o anúncio; onde atende (país/estado/cidade/raio); quanto pode investir por mês; o que faz o cliente escolher esse negócio; se já anunciou antes e como foi; o que já tem pronto (site, WhatsApp, catálogo, fotos, vídeos, avaliações); quem responde os contatos e em quanto tempo.

Nada de "topo/meio/fundo" na entrevista. A divisão de funil passa a ser decidida pela IA e aparece no plano com a explicação em português claro — com um botão discreto **"Ajuste avançado"** para quem quiser mexer nos percentuais e regerar.

## O plano gerado (pronto para execução + roteiro de criativos)

O plano deixa de ser uma lista solta de iniciativas e passa a ter três camadas:

1. **Resumo executivo** — objetivo, verba, como o dinheiro foi dividido entre Meta e Google e por quê, em linguagem simples.
2. **Campanhas** — cada campanha traz: plataforma, tipo de campanha real da plataforma, objetivo de otimização, evento de conversão, públicos/segmentação, orçamento diário e mensal, formatos e posicionamentos, e metas estimadas (faixa de custo por resultado e volume esperado, sempre como estimativa).
   - Meta: Vendas (catálogo/site), Cadastros (site ou formulário instantâneo), Tráfego, Engajamento, Reconhecimento, Advantage+ Shopping, retargeting por público personalizado e semelhante.
   - Google: Search (grupos de palavras-chave com tipos de correspondência e negativas), Performance Max, Demand Gen, Display, Vídeo/YouTube, Local/Máximo de desempenho com metas de loja, Shopping quando houver catálogo.
3. **Roteiro de criativos** — por campanha: ângulos de mensagem, títulos e descrições dentro dos limites reais de caracteres de cada plataforma, chamadas para ação e ideias de imagem/vídeo (formato, duração, primeira cena).

Também entram avisos práticos de pré-requisito quando o quiz revelar lacunas: sem pixel/conversões configuradas, sem catálogo, sem página de destino adequada, verba baixa demais para dividir em muitas campanhas.

## Agente de IA dedicado

Novo agente `media_planner_paid` no catálogo de agentes (com override por workspace, como os demais), especializado em Meta Ads e Google Ads: nomenclatura oficial de tipos de campanha, objetivos e eventos, estruturas de conta, limites de caracteres, requisitos de catálogo/pixel/conversões, quando cada tipo é indicado e quando não é, e regras de verba mínima por campanha para não pulverizar orçamento.

A geração roda como job assíncrono (mesmo padrão da Pauta): progresso na tela, retomada em caso de falha, saída estruturada validada e normalizada (soma de verba fecha 100%, orçamento diário coerente, textos dentro dos limites). Resposta sempre em pt-BR. A entrevista fica salva junto do plano, então é possível regerar mudando uma resposta sem refazer tudo.

## Escopo e permissões

Somente equipe interna responde a entrevista (o cliente continua vendo o plano final pelo link público/portal). Permissões e RLS seguem o módulo de plano de mídia já existente, por workspace e cliente.

## Detalhes técnicos

Banco (uma migração):
- `media_plans`: colunas novas `interview` (jsonb, respostas do quiz), `strategy` (jsonb, resumo/divisão de funil/justificativas), `plan_version` (int).
- `media_plan_items`: colunas novas `platform`, `campaign_subtype`, `optimization_goal`, `conversion_event`, `daily_budget`, `targeting` (jsonb), `placements` (text[]), `creative_brief` (jsonb), `estimates` (jsonb), `prerequisites` (text[]), `rationale`.
- Seed do agente `media_planner_paid` em `agent_prompts` (idempotente, `ON CONFLICT`).
- Sem mudança de policy: as tabelas já têm RLS por workspace/cliente; as colunas herdam.

Código:
- `src/lib/media-plan/interview-schema.ts` — definição declarativa das perguntas, opções, ícones e regras de ramificação (fonte única para UI e prompt).
- `src/components/media-plans/media-plan-interview.tsx` — wizard passo a passo, cartões selecionáveis, barra de progresso, voltar/avançar, rascunho salvo localmente.
- `src/lib/media-plan-agent.server.ts` — prompt do especialista + geração estruturada (Output.object com schema enxuto, salvamento por fallback de texto), reaproveitando `getBrandAiModel`, `ai-language`, `ai-output-salvage` e as opções provider-aware já usadas na Pauta.
- `src/lib/media-plans-ai.functions.ts` — passa a enfileirar job (`kind: "media_plan"`) recebendo a entrevista; mantém compatibilidade com planos antigos.
- `src/routes/_authenticated/customers.$customerId.media-plan.tsx` — nova apresentação em três camadas, "Ajuste avançado" de funil, botão de regerar campanha isolada.
- `src/components/media-plans/create-media-plan-dialog.tsx` — substitui o formulário técnico pela entrevista (mantém título, período e verba).
- KPIs do plano via `PageKpi`/`PageKpiGrid`.
- Testes: ramificação da entrevista, normalização de verba/limites de caracteres, e schema do agente.

MASTER (replicação nas instalações):
- Regenerar `supabase/baseline-snapshot/007_delta_migrations.sql` e `tools/delta_manifest.txt` incluindo a nova migração.
- Elevar `MASTER_RELEASE_VERSION` para `1.2.0` em `src/lib/installation/manager-contract.ts`.
- Atualizar `supabase/install/verify-installation.sql` com checagens das colunas novas e do seed do agente, e ajustar os limiares de tabelas/policies.
- Publicar o MASTER e depois clicar em "Atualizar" em cada instalação (Administração → Instalações).

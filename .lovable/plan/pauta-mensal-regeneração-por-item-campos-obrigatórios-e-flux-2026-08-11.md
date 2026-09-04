# Pauta mensal — regeneração por item, campos obrigatórios e fluxo de aprovação

Quatro mudanças na Pauta (`/customers/$id/pauta` e `/monthly-plan`), mantendo o gerador atual.

## 1. Regenerar item específico

Cada card de ideia ganha um botão "Regenerar" com um campo opcional "o que mudar"
(ex.: "mais focado em prova social"). A IA recebe o contexto completo da pauta
(tema, descrição, objetivos, briefing) + os títulos dos outros itens para não repetir,
e devolve novo título e novo gancho **mantendo plataforma e formato do item**.
O item é atualizado no lugar (sem criar novo), com histórico simples: guardamos a
versão anterior do título/gancho para permitir "desfazer" na sessão.

Estado visual: spinner no card, restante da pauta segue utilizável.

## 2. Campos obrigatórios: volumetria, plataforma, formato

**Antes de gerar** (tela inicial):
- Se o cliente não tiver volumetria no briefing, a geração fica bloqueada com aviso
  e link direto para o Briefing. (Sem override manual, conforme decidido.)
- Mostramos o mix mensal calculado (posts/semana × 4,3) por canal antes de gerar,
  para o usuário confirmar o total.

**Ao aprovar**:
- Todo item precisa de `channel` (plataforma) e `content_format`. Itens incompletos
  aparecem destacados; o botão de aprovar informa quantos faltam e não deixa seguir.
- Validação repetida no servidor (não confia só na UI).

Cada card passa a ter dois seletores: **Plataforma** (instagram, tiktok, linkedin,
youtube, facebook) e **Formato** (Reels, Carrossel, Storie, Post estático, Vídeo curto).
Novos itens criados manualmente nascem sem plataforma e precisam ser preenchidos.

## 3. Briefing como contexto padrão

O briefing deixa de ser opcional no fluxo: a geração sempre usa o briefing
consolidado do cliente (`clients.brand_hub`) — identidade, produto, público,
concorrentes, estética, metas — mais os resumos de documentos, como já ocorre na
Estratégia IA. O seletor "Vincular a um briefing" continua existindo apenas para
escolher uma versão específica de `brand_briefings`; quando nenhum é escolhido,
o consolidado atual é usado automaticamente e a tela mostra "Contexto: briefing do
cliente (automático)".

Consequência: o campo "Tema do mês" volta a ser realmente opcional e a mensagem
"Descreva um tema ou vincule um briefing" desaparece.

## 4. Fluxo: aprovação interna → cliente → produção

Hoje um único botão cria os cards no Kanban direto. Novo fluxo em três estágios:

```text
rascunho ──(equipe aprova/rejeita cada item)──▶ pronto p/ cliente
   │                                                  │
   │                                        gera link público de aprovação
   │                                                  ▼
   └──────────── ajustes ◀── cliente pede mudança ── cliente aprova
                                                       │
                                                       ▼
                                        cards criados no Kanban (só itens aprovados)
```

- **Aprovação interna**: cada card tem Aprovar / Rejeitar. Rejeitados ficam
  visíveis mas esmaecidos e nunca geram card. O botão "Enviar para o cliente"
  só habilita quando todos os itens estão decididos e completos.
- **Envio ao cliente**: gera um link público (token com validade) para uma página
  somente-leitura da pauta, onde o cliente aprova a pauta inteira ou solicita
  ajustes com comentário. Sem login.
- **Produção**: os cards no Kanban são criados **somente após a aprovação do
  cliente** — evitando os cards desnecessários de hoje. Itens rejeitados na etapa
  interna ficam de fora.
- A pauta mostra uma barra de status com o estágio atual, quem aprovou e quando.

## Detalhes técnicos

**Banco (migração)**
- `monthly_plans.status`: adicionar estágios `pending_client`, `client_approved`,
  `changes_requested` (mantendo `draft`/`approved`/`archived`), além de
  `internal_approved_at/by`, `client_decision_at`, `client_feedback`.
- `monthly_plan_topics`: `channel` e `content_format` passam a ser exigidos na
  aprovação (validação em código, não NOT NULL, para não quebrar pautas antigas);
  novo `previous_title`/`previous_angle` para o desfazer da regeneração.
- Nova tabela `monthly_plan_tokens` (token, plan_id, brand_id, client_id, expires_at,
  revoked_at) com GRANTs e RLS espelhando `card_approval_tokens`; leitura pública
  apenas via server function que resolve o token.

**Server functions** (`src/lib/monthly-plans.functions.ts`)
- `regenerateTopicFn` — nova, usa `getBrandAiModel(..., "text")` como o gerador atual.
- `setTopicDecisionFn` — aprovar/rejeitar item.
- `submitPlanToClientFn` — valida completude, cria token, marca `pending_client`.
- `approveMonthlyPlanFn` — passa a exigir `client_approved` antes de inserir em `posts`.
- Novo `src/lib/monthly-plan-public.functions.ts` — resolve token, retorna pauta
  somente-leitura, registra decisão do cliente (espelha o padrão de
  `media-plan-public.functions.ts`).
- Geração: contexto de briefing sempre montado a partir de `clients.brand_hub` +
  `client_documents.ai_summary`; volumetria obrigatória (erro claro se ausente).

**UI**
- `src/routes/_authenticated/customers.$customerId.pauta.tsx`: cards com plataforma,
  formato, regenerar, aprovar/rejeitar; barra de status; nova sticky bar contextual.
- Nova rota pública `src/routes/pauta.$planId.tsx` (`?token=`), `noindex`, no padrão
  visual de `plano.$planId.tsx`.
- Sem cores hardcoded novas — tokens do design system.

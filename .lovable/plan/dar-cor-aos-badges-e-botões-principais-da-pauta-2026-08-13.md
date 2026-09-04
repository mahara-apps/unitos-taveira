# Dar cor aos badges e botões principais da Pauta

## Contexto
No tema dark, `--primary` é branco puro e `secondary`/`outline`/`ghost` são todos cinza. Resultado: a tela de aprovação da pauta fica preto/cinza/branco, com cor apenas nos banners de status e na borda esmeralda dos cards aprovados. O usuário quer cor semântica nos badges e botões principais.

O padrão de cor por status (emerald=aprovado, amber=pendência/ajuste, rose=rejeitado, sky=enviado) já existe no arquivo (`PLAN_STATUS_META`, `StatusBanner`, badges de `client_status`). O plano **estende esse mesmo padrão** aos elementos que hoje estão monocromáticos — sem inventar nova paleta nem mexer em lógica/dados.

## Escopo (somente `src/routes/_authenticated/customers.$customerId.pauta.tsx` e `src/components/monthly-plan/*.tsx`)
Zero mudança de lógica, tipos, queries ou mutations. Só classes CSS e variantes de botão.

## Mudanças

### 1. Botão hero "Gerar pauta com IA" (Estado 1)
- Trocar `variant` default por `variant="ai"` (gradiente violeta/fúcsia/índigo já definido em `button.tsx`). É o CTA de IA — o gradiente já é a linguagem do sistema para ações de IA.

### 2. Botão "Aprovar todos" (cabeçalho dos tópicos)
- Trocar `variant="secondary"` (cinza) por um estilo emerald sólido: `bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25`. Ação em massa de aprovação → verde.

### 3. Badge de status do tópico no card (novo)
Hoje o status (pending/approved/rejected) só aparece pela borda do card. Adicionar um badge pequeno no canto do `TopicCard`:
- `pending` → amber (`bg-amber-500/15 text-amber-400 border-amber-500/30`, texto "Pendente")
- `approved` → emerald ("Aprovado")
- `rejected` → zinc/rose ("Descartado")
Usa as mesmas classes já presentes no arquivo.

### 4. Botões por tópico
- **"Aprovar"**: quando ativo (aprovado), usar emerald (`bg-emerald-500/15 text-emerald-400 border-emerald-500/30`) em vez de `variant="default"` branco. Quando inativo, manter outline.
- **"Descartar"**: quando ativo (rejeitado), usar rose (`bg-rose-500/15 text-rose-400 border-rose-500/30`) em vez de `variant="secondary"`.
- **"Regenerar"** / **"Desfazer"**: manter ghost (são secundários).

### 5. Bar fixa inferior (sticky action bar)
- **"Enviar ao cliente para aprovação"** / **"Enviar para produção"**: manter `variant="default"` (branco) — já é o CTA mais forte e se destaca no dark.
- **"Descartar pauta"**: trocar o `outline + text-destructive` por `variant="destructive"` outline-style: `border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10`. Mais visível como ação destrutiva.
- **"Copiar link do cliente"**: manter secondary.

### 6. Chips de contexto (`ContextSourcesRow`)
Hoje os chips "ok" são cinza. Dar cor semântica sutil:
- Estratégia IA → indigo/violeta (`text-violet-400 border-violet-500/30 bg-violet-500/5`)
- Métricas reais → sky (`text-sky-400 border-sky-500/30 bg-sky-500/5`)
- Briefing + Brain → emerald (`text-emerald-400 border-emerald-500/30 bg-emerald-500/5`)
- Chips "warn" continuam amber.

### 7. Cards de volumetria (`VolumetryCards`)
- Card "Total do cliente" (`emphasis`): trocar `border-primary/40 bg-primary/5` por emerald (`border-emerald-500/30 bg-emerald-500/5`) e colorir a barra `Progress` emerald via `style`/classe de indicador. Destaque positivo.
- Cards por canal: manter neutro (a barra Progress já dá contraste).

## Não incluído
- Nenhuma mudança em queries, mutations, tipos, server functions ou DB.
- Não alterar `PLAN_STATUS_META` (badges do histórico já têm cor).
- Não introduzir novos tokens em `styles.css` (usa as cores Tailwind já presentes no arquivo).

## Verificação
- Build/typecheck passa (só classes/variantes).
- Conferir visualmente os dois estados (geração e aprovação) quando a sessão voltar — auth é `external_unmanaged`, então confirmação visual fica pendente; a mudança em si é só CSS e não depende de sessão.

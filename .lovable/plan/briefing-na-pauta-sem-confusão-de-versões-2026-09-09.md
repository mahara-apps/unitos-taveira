# Briefing na pauta: sem confusão de versões

## O que está acontecendo

1. Na tela "Gerar pauta com IA" aparece uma lista de "Versões" do briefing. Ela mostra o histórico de auditoria bruto, o que faz o usuário achar que precisa escolher algo — quando na verdade a IA já usa o briefing atual do cliente.
2. As versões com segundos de diferença não são erro de dados: o assistente rápido de briefing salva a cada passo, e cada salvamento grava um registro. Resultado: três registros de 53% e três de 58% em poucos segundos.
3. Hoje não existe forma de nomear uma versão — só data e percentual.

## O que vai mudar

**Passo 1 do "Gerar pauta com IA"**
- A lista sai da frente. No lugar, uma linha informativa: "Briefing atual do cliente — 58% completo, atualizado em 09/09 12:04".
- Um link discreto "Usar uma versão anterior" abre a escolha para quem realmente precisa; fechado, continua valendo o briefing atual.
- A geração em si não muda: sem escolha, a IA usa o briefing atual, exatamente como já faz.

**Histórico de briefing mais limpo**
- Salvamentos seguidos da mesma pessoa, na mesma origem e dentro de 10 minutos passam a atualizar o mesmo registro em vez de criar um novo: o snapshot mais recente vence e a lista de campos alterados é somada. Um assistente de 3 passos gera um registro, não três.
- Registros de origens diferentes (importação por IA, portal do cliente, edição manual) nunca são agrupados entre si.

**Nome nas versões**
- Cada versão ganha um nome editável. Sem nome, mostra o rótulo automático de hoje (data + percentual).
- Ao aplicar uma importação por IA ou uma resposta do portal, o nome já vem sugerido ("Importação por IA", "Resposta do cliente").
- No histórico do briefing é possível renomear; a escolha avançada na pauta mostra o nome quando existir.

## Detalhes técnicos

- Migração: coluna `label text` em `brand_briefing_versions` (nullable), sem alteração de RLS/GRANTs existentes; nada é apagado.
- `writeCanonicalBriefing` (`src/lib/briefing-write.server.ts`): antes do insert, procura a última versão do mesmo `client_id`/`brand_id`/`changed_by`/`origin` criada há menos de 10 minutos; se existir, faz `update` de `snapshot`, `completion`, `status`, `changed_fields` (união) e `created_at`; caso contrário insere. Aceita `label` opcional.
- `listBriefingsForPlanFn` (`src/lib/monthly-plans.functions.ts`): retorna também `label`, `completion` e `created_at`; o item mais recente é marcado como atual.
- `generate-plan-wizard.tsx`: substitui o `Select` sempre visível pelo resumo do briefing atual + bloco avançado recolhido com o mesmo `Select` (valor padrão continua "Nenhum" = briefing atual).
- Renomear: nova server function autenticada `renameBriefingVersionFn` validando escopo `brand_id`/`client_id` e autoridade já usada no briefing; UI no histórico do briefing (`briefing-workspace.tsx`).
- Sem mudança em rotas, permissões, RLS ou regra de geração de pauta.
- Testes unitários: agrupamento por janela de tempo/origem e rótulo exibido.
- MASTER-first: delta regenerado, `delta_version.txt` + `MASTER_RELEASE_VERSION` em 1.3.21, nova coluna coberta no `verify-installation.sql`, `bun run master:check` verde.

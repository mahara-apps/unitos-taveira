# Correção definitiva da geração de pauta

## Diagnóstico confirmado

A IA não é a causa da falha atual: nas duas execuções mais recentes, o Gemini concluiu a geração com sucesso e o erro aconteceu somente em **“Salvando a pauta”**.

O fluxo possui uma incompatibilidade entre a fonte atual do briefing e uma referência legada:

- O seletor lista IDs de `brand_briefing_versions`.
- O contexto da IA também lê o ID selecionado em `brand_briefing_versions`.
- Ao salvar, o mesmo ID é enviado para `monthly_plans.input_briefing_id`.
- Porém, a FK `monthly_plans_input_briefing_id_fkey` ainda referencia `brand_briefings(id)`.
- O cliente da execução possui versões atuais, mas não possui linha correspondente em `brand_briefings`; por isso o Postgres retorna `23503`.

Isso explica exatamente as falhas recentes e por que nenhum conteúdo incompleto foi salvo.

## Correção

1. **Validar a versão antes de chamar a IA**
   - Resolver o `briefingId` em `brand_briefing_versions` usando simultaneamente `id`, `brand_id` e `client_id`.
   - Rejeitar de forma clara uma versão inexistente ou fora do escopo, antes de gastar uma chamada de IA.

2. **Separar contexto atual de referência legada**
   - Continuar usando a versão selecionada como contexto da geração.
   - Não gravar um ID de `brand_briefing_versions` no campo legado `monthly_plans.input_briefing_id`.
   - Salvar a referência da versão atual em `monthly_plans.context_sources.briefing_version_id`; manter `input_briefing_id` nulo nesse novo fluxo.
   - Preservar a leitura de pautas antigas que ainda possuem um `input_briefing_id` válido de `brand_briefings`.

3. **Retomada e regeneração seguras**
   - Fazer a retomada reutilizar a referência registrada em `context_sources.briefing_version_id`.
   - Fazer a regeneração de item preferir essa referência atual e usar o campo legado somente como fallback compatível.
   - Não reaproveitar checkpoint de outro cliente, workspace ou período.

4. **Falha clara e sem execução desperdiçada**
   - Adicionar código/mensagem específica para versão de briefing inválida ou indisponível.
   - Manter a mensagem real de persistência e a regra de nunca salvar pauta parcial.

## Validação

- Teste unitário do mapeamento: versão atual entra em `context_sources`, nunca na FK legada.
- Testes de versão válida, inexistente e pertencente a outro cliente/workspace.
- Testes de geração sem versão específica, retomada e regeneração de item.
- Confirmar que uma pauta antiga com referência legada continua legível.
- Executar uma geração real e verificar: job concluído, pauta e tópicos persistidos e referência correta em `context_sources`.
- Rodar testes direcionados, suíte completa, typecheck e build.

## Fora de escopo

Sem migration ou alteração de banco; sem mudanças em RBAC, RLS, autenticação, tenants/workspaces, Instalação × Workspace ou provedor de IA.

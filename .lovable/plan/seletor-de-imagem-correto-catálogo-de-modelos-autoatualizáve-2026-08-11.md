# Seletor de imagem correto + catálogo de modelos autoatualizável

## 1. Anthropic fora do seletor de imagem

Hoje o seletor "Modelo de imagem ativo" lista os três provedores, mas a Anthropic não gera imagem (o catálogo até cai num modelo de texto como falso "image").

- Marcar capacidade por provedor no catálogo: `text: true` para os três, `image: true` só para OpenAI e Gemini; remover o fallback falso `anthropic.image`.
- O seletor de imagem passa a listar apenas provedores com capacidade de imagem. O seletor de texto continua com os três.
- No cartão da Anthropic, badge "Somente texto" para deixar explícito.
- Guarda no servidor: salvar `image_provider = anthropic` é rejeitado; se a marca já estiver nesse estado, o resolvedor de imagem cai em OpenAI/Gemini com chave válida.

## 2. Garantia de modelos: troca automática + alerta in-app

Já existe um health check semanal que testa apenas o modelo "operacional" de cada provedor e grava em `ai_model_health`, sem avisar ninguém e sem atualizar a lista. Vira um ciclo completo:

- **Verificar tudo**: para cada provedor com chave ativa, testar os modelos de todos os papéis (estratégico, operacional, imagem).
- **Classificar a falha**: distinguir "modelo descontinuado/inexistente" (404, `model_not_found`, `deprecated`) de problemas de chave, cota ou rede — só o primeiro caso dispara troca.
- **Descobrir o sucessor**: consultar a lista oficial de modelos do provedor (OpenAI `/v1/models`, Anthropic `/v1/models`, Gemini `ListModels`) e escolher o mais recente da mesma família e mesmo papel.
- **Trocar automaticamente**: gravar o novo ID numa tabela de overrides do catálogo; todos os pontos de IA passam a usar o modelo novo na hora, sem deploy. Se nenhum sucessor for encontrado, mantém o atual e o alerta é de "ação necessária".
- **Alertar o admin**: notificação in-app (tipo `system`) para os super admins, com provedor, papel, modelo antigo, modelo novo e motivo, linkando para Conexões.
- **Mostrar o estado**: na aba IA de Conexões, cada cartão exibe os modelos em uso (incluindo os substituídos), a data da última verificação e um botão "Verificar modelos agora".
- **Agendamento**: cron diário chamando o hook de health, além da execução manual.

## Detalhes técnicos

- `src/lib/ai-models-catalog.server.ts`: adicionar `PROVIDER_CAPABILITIES`, remover `anthropic.image`, e trocar `getModel` síncrono por `resolveModel(provider, role)` async que lê overrides do banco (cache em memória por alguns minutos) com fallback nos defaults compilados.
- Migração: tabela `ai_model_catalog_overrides` (provider, role, model_id, replaced_model_id, reason, source, updated_at; unique provider+role) com GRANTs (`select` para `authenticated`, `all` para `service_role`), RLS e leitura restrita a super admins; `ai_model_health` ganha coluna `role`.
- `src/routes/api/public/hooks/ai-models-health.ts`: loop por papel, classificador de erro, descoberta de sucessor via API do provedor, upsert do override e insert em `notifications` para cada super admin.
- `src/lib/ai-provider.server.ts`: `getBrandAiModel`/`getBrandAiModelAdmin`/`generateBrandImage` usam `resolveModel`; `generateBrandImage` já ignora Anthropic — reforçar a checagem por capacidade.
- `src/lib/connections.functions.ts`: validar `image_provider` contra provedores com capacidade de imagem; expor `modelHealth` (modelos ativos + última verificação) para a UI.
- `src/routes/_authenticated/connections.tsx`: `LeaderPicker` recebe `kind` e filtra as opções; cartões mostram modelos ativos/último check e o botão de verificação manual.

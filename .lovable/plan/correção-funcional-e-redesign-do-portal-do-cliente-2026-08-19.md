# Correção funcional e redesign do Portal do Cliente

## Diagnóstico confirmado

- As páginas compartilham server functions que não seguem o limite de execução do TanStack Start: helpers, schemas e constantes de runtime estão no mesmo módulo de `createServerFn`. No split do servidor esses símbolos podem desaparecer, causando falhas generalizadas mesmo com build válido.
- O portal autenticado lê `portal.session.clientId` e resolve a sessão antes de conferir se esse vínculo ainda existe. Um ID removido ou antigo derruba o shell inteiro com `client_not_allowed`.
- Os retries são incompletos em alguns agregadores: a Home não considera todas as queries ao decidir erro e não refaz a consulta de aprovações pendentes.
- A identidade digitada só existe para o modo token. No login, o banco já usa `user_profiles.full_name`; no token, o nome pode ser obtido do contato/cliente já validado pelo escopo, sem input improvisado.
- O SLA não foi apagado do banco: continua em `content_pipeline_stages.sla_hours/sla_days`, combinado com `posts.stage_id` e `posts.stage_entered_at`. Há 43 posts visíveis no portal, 37 ligados a etapa e 32 atualmente rastreáveis por SLA no cliente com maior volume. O portal deixou de projetar esses dados; hoje só exibe prazo de briefing.
- Não há `sla_rules` ativos, nenhum arquivo está marcado `visible_to_client`, e há apenas uma solicitação de briefing já não pendente. Esses casos devem aparecer como vazios reais, não como erro.

## Implementação

1. **Estabilizar a camada de dados do portal**
   - Tornar cada arquivo `*.functions.ts` um wrapper fino: mover schemas, clientes, resolução, assinatura de mídia e transformações para helpers `*.server.ts`/módulos seguros.
   - Preservar `portal_resolve` como fonte única de escopo e validar sempre `brandId + clientId` antes de qualquer leitura privilegiada.
   - Corrigir seleção de cliente autenticado: validar o ID salvo contra `portal_my_clients`, cair no primeiro vínculo válido e limpar IDs obsoletos.
   - Padronizar erros retornados e retry real, incluindo todas as queries da Home e detalhes em dialogs.

2. **Restaurar SLA existente no local correto**
   - Reusar exatamente a fórmula atual do pipeline (`sla_hours`, fallback `sla_days * 24`, tempo desde `stage_entered_at`; em risco a partir de 80%, atrasado em 100%).
   - Expor ao portal apenas projeções seguras do próprio cliente: status, prazo estimado, tempo restante/atraso e contagens.
   - Reintegrar o resumo de SLA na Home e o indicador contextual nos conteúdos, sem criar nova tela nem nova fonte de verdade.

3. **Remover identidade manual**
   - Remover o campo do header, o armazenamento local e o provider de nome.
   - Login: registrar decisões com o perfil autenticado, como o banco já prevê.
   - Token: resolver automaticamente `contact_name` e, como fallback, o nome do cliente após validar o token; nunca aceitar identidade arbitrária do browser.

4. **Corrigir as sete experiências**
   - Início: queries independentes tolerantes a falha parcial, ações, próximos itens, briefings e SLA real.
   - Aprovações: filtros funcionais, detalhe recuperável, decisão/comentário e indicadores de prazo/SLA.
   - Pauta: manter decisão item a item e materialização existentes, corrigindo loading/error/retry e responsividade.
   - Calendário: mês/agenda com dados reais e detalhe com erro recuperável.
   - Briefing: manter proposta/revisão versionada, KPIs com `PageKpi`, prazos e histórico.
   - Arquivos: busca com debounce, URLs assinadas isoladas por arquivo e vazio correto quando nada foi liberado.
   - Minha Marca: dados reais; atualização continua pelo fluxo autorizado de briefing, com CTA contextual quando houver solicitação editável.

5. **Redesign somente do Portal**
   - Manter sidebar e arquitetura atual, em light mode, refinando identidade, ativo, header, largura, ritmo vertical e navegação mobile.
   - Usar cores semânticas para pendente, aprovado, ajuste, publicado e SLA; reduzir caixas desnecessárias.
   - Padronizar skeletons, vazios, erros e botões de retry com componentes existentes do design system.

## Validação

- Executar regressão de isolamento/RPC do portal e adicionar cobertura para cliente salvo inválido, identidade automática, retry e cálculo de SLA.
- Smoke test runtime das rotas Início, Aprovações, Pauta, Calendário, Briefing, Arquivos e Minha Marca no modo token, validando console/rede e estados com e sem dados.
- Validar o modo login por testes autenticados/RPC; como o Supabase é externo e a sessão E2E não pode ser injetada automaticamente, a validação visual autenticada dependerá de uma sessão já aberta no preview.
- Verificar desktop e mobile, build atual e logs finais sem alterar o painel interno/admin.

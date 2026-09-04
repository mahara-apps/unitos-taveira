# Geração de estratégia por IA — diagnóstico e correção

## O que a verificação encontrou (dados reais)

Consultei o histórico de execuções e a configuração de IA da marca.

1. **Nenhuma geração de estratégia jamais concluiu.** As 11 execuções de `customer_strategy` estão todas em `failed`:
   - até 10/08: `timeout: worker interrompido antes da conclusão` (travando em 20% ou 55%) — causa que o refactor por etapas já endereçou;
   - 12/08 (última tentativa, já com o refactor): `Falha na etapa "Estruturando briefing": Missing Supabase environment variable(s): SB_SERVICE_ROLE_KEY`.
   Ou seja: desde o refactor houve **uma única** tentativa, e ela morreu por variável de ambiente. A chave de service role está bindada agora no ambiente, então essa causa específica está resolvida — mas isso nunca foi validado com uma execução real.

2. **Bloqueio ativo hoje: o modelo estratégico do provedor está descontinuado.** A marca usa Gemini (chave válida, 52 modelos na conta) e o catálogo compilado define `strategic: gemini-2.5-pro`. O job de plano mensal executado hoje às 15:36 falhou com:
   `This model models/gemini-2.5-pro is no longer available to new users.`
   A estratégia usa o mesmo papel `strategic`, portanto falharia igual. É a próxima parede depois do problema de ambiente.

3. **O auto-healing do catálogo nunca rodou.** `ai_model_catalog_overrides` está vazia. O hook diário `/api/public/hooks/ai-models-health` autoriza comparando com `SUPABASE_ANON_KEY`, variável que não existe no ambiente (o projeto usa `SUPABASE_PUBLISHABLE_KEY`) — então o hook responde 401 sempre e o catálogo nunca se autocorrige. Por isso o modelo descontinuado permaneceu em uso.

4. **Provedor e contexto do briefing estão corretos.** O pipeline usa a chave da própria marca (`getBrandAiModelAdmin`), sem cair em IA do Lovable, e compõe o briefing a partir do cadastro + Cérebro da Marca + documentos analisados.

## Correções

### A. Destravar o modelo estratégico
- Atualizar o catálogo compilado para um modelo Gemini atualmente disponível na conta, em vez do `gemini-2.5-pro` descontinuado (verificando a lista real de modelos da chave da marca antes de fixar o ID).
- Ao resolver o modelo, se o provedor rejeitar por indisponibilidade, cair automaticamente no próximo modelo válido do mesmo papel e registrar o override — em vez de falhar o job inteiro.

### B. Fazer o auto-healing funcionar de verdade
- Corrigir a autorização do hook de saúde para aceitar a chave publicável usada no projeto, mantendo a rejeição de chamadas não autenticadas.
- Executar o health check uma vez manualmente para popular `ai_model_catalog_overrides` e confirmar que os papéis `strategic`/`operational`/`image` apontam para modelos vivos.

### C. Erros legíveis e diagnóstico
- Mensagem clara no painel quando o modelo estiver indisponível/chave inválida ("o modelo X foi descontinuado pelo provedor — atualizado para Y"), no lugar do texto cru do provedor.
- Registrar provedor + modelo usados por etapa no job, para o indicador de IA mostrar o que rodou.

### D. Validação real (obrigatória para fechar)
- Disparar uma geração de estratégia real e acompanhar até 100%, confirmando que briefing, voz, personas, cohorts e SWOT foram gravados.
- Repetir o teste do plano mensal, que compartilha o mesmo papel de modelo.

## Detalhes técnicos

- `src/lib/ai-models-catalog.server.ts`: trocar o default `gemini.strategic`; expor um fallback ordenado por papel.
- `src/lib/ai-provider.server.ts`: no erro de modelo indisponível, tentar o próximo ID do papel e gravar override em `ai_model_catalog_overrides`.
- `src/routes/api/public/hooks/ai-models-health.ts`: comparar com `SUPABASE_PUBLISHABLE_KEY` (mantendo compatibilidade com `SUPABASE_ANON_KEY`).
- `src/routes/api/jobs/customer-pipeline.ts`: persistir `provider`/`model` por etapa em `ai_jobs.result` e normalizar a mensagem de erro.
- Sem migração de schema prevista.

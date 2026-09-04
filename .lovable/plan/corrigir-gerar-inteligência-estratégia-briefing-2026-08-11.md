# Corrigir "Gerar Inteligência" (Estratégia & Briefing)

## O que a auditoria encontrou

Rodei o fluxo de ponta a ponta (botão → `/api/jobs/customer-pipeline` → provedor de IA → tabelas de estratégia) e consultei o histórico real de execuções.

**1. Todos os jobs de estratégia falham por estouro de tempo — confirmado nos dados.**
Os 10 últimos jobs `customer_strategy` terminaram com `timeout: worker interrompido antes da conclusão`, sempre travados em 20% ("Modelando voz e personas") ou 55% ("Construindo cohorts"), ~5–6 min após o início. Nenhum job de estratégia jamais concluiu. Outros jobs do sistema (post fase 2, plano mensal) concluem normalmente em 9–12s, então o mecanismo de fundo funciona — o problema é específico deste pipeline, que é longo.

Causa: o pipeline roda **5 chamadas de IA em sequência dentro de uma única execução de fundo**, cada uma com modelos "estratégicos" de raciocínio (gpt-5 / claude-opus / gemini-2.5-pro) e resposta em bloco (sem streaming). O ambiente de execução encerra o processo antes do fim; a trava interna de 60s nem chega a disparar, e a rotina de limpeza do banco marca o job como falho após 5 min sem sinal de vida.

**2. Dados do briefing chegam quase completos — mas faltam dois blocos.**
O backend monta o briefing a partir do cadastro do cliente + Cérebro da Marca e cobre Identidade, Produto, Público, Concorrentes, Estética (paleta/hashtags/do–don't) e Metas/Volumetria. Ficam de fora:
- **Documentos & Contexto IA**: o que a IA extrai dos documentos é gravado em `brand_briefings.data`, e o pipeline nunca lê essa tabela — ele insere uma linha nova. Ou seja, contexto de documentos é ignorado.
- **Formatos por rede** (`formats` do bloco Volumetria) não é enviado.

**3. Provedor selecionado: está correto.**
O pipeline usa `getBrandAiModelAdmin`, que lê o provedor escolhido em Conexões e a chave da marca, sem cair no Lovable AI. Nada a corrigir aqui além de tornar visível qual provedor/modelo rodou cada etapa (hoje não fica registrado, o que dificulta diagnóstico).

## Como vamos corrigir

### A. Pipeline resumível por etapas (resolve o timeout)
- Quebrar o pipeline em etapas independentes: `briefing → voz → personas → cohorts → swot`.
- Cada disparo executa **uma** etapa e agenda a próxima via nova chamada interna, salvando o resultado parcial no banco. Assim nenhuma execução passa de poucas dezenas de segundos.
- Etapa que falha pode ser retomada de onde parou, em vez de recomeçar tudo.
- Sinal de vida (heartbeat) durante a etapa, para a limpeza automática não matar um job saudável.
- Voz e personas param de rodar em paralelo dentro da mesma execução (duas chamadas pesadas simultâneas era exatamente o ponto de morte em 20%).

### B. Reduzir o tempo de cada etapa
- Usar chamadas em streaming consumidas no servidor (mantém o tráfego fluindo e evita corte por inatividade), em vez de resposta em bloco.
- Usar o modelo "operacional" (mais rápido) para etapas de estruturação e reservar o "estratégico" para voz/personas/SWOT.
- Enxugar o prompt: hoje cada etapa recebe o JSON completo das anteriores; passaremos um resumo compacto.
- Trava por etapa mais curta com uma nova tentativa automática, em vez de um único limite de 60s que nunca é atingido.

### C. Alimentar a IA com todo o briefing
- Incluir na composição do briefing: contexto extraído dos documentos (`brand_briefings.data` + resumos de documentos analisados) e os formatos por rede.
- Em vez de sempre inserir uma linha nova em `brand_briefings`, mesclar com o que já existe, preservando o que veio dos documentos.
- Mostrar no painel de estratégia quais blocos entraram no briefing usado (Identidade, Produto, Público, Concorrentes, Estética, Metas, Documentos), para o usuário saber o que a IA viu.

### D. Transparência de provedor
- Registrar provedor + modelo usados por etapa no job e exibir no indicador de IA / painel de estratégia.
- Mensagens de erro claras quando faltar chave, o provedor rejeitar a chave ou o modelo estiver indisponível.

## Detalhes técnicos

- `src/routes/api/jobs/customer-pipeline.ts`: refatorar em runner por etapa (`step` no corpo da requisição), persistindo estado intermediário em `ai_jobs.result`/`input`; re-disparo interno autenticado por token de serviço; heartbeat via `updated_at`.
- Substituir `generateText` + `Output.object` por chamada em streaming consumida no servidor, mantendo o parser tolerante e os normalizadores PT-BR já existentes.
- `composeBriefingFromRecord`: adicionar `formats`, `client_documents.ai_summary` (documentos analisados) e o `brand_briefings.data` mais recente; deduplicar campos.
- Escrita em `brand_briefings`: upsert/merge em vez de insert cego.
- Sem mudanças de schema previstas; se o registro de provedor/modelo por etapa exigir coluna, será em `ai_jobs` via migração.
- Ao final: validar com uma execução real do botão e confirmar que o job chega a 100% e grava voz, personas, cohorts e SWOT.

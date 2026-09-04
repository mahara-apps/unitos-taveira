# Correção: geração de pauta com IA falhando

## O que está acontecendo (confirmado nos logs e no código)

Nos logs do servidor a sequência real é:

1. O provedor primário (Gemini) responde **429 — quota do free tier esgotada** ("Quota exceeded for … generate_content_free_tier_requests, limit: 20").
2. O fallback funciona e alterna para Groq (`openai/gpt-oss-120b` / `gpt-oss-20b`).
3. A tentativa no Groq falha e o pipeline encerra classificando como `invalid_request` e, em outra execução, `invalid_output`.
4. A UI mostra apenas `ai_generation_failed` / "A IA não conseguiu concluir a geração", sem dizer que o limite do Gemini foi atingido.

Causa provável do erro no fallback: o schema enviado ao provedor tem limites de tamanho (`topics` com mínimo 1 e máximo 60) em `src/lib/monthly-plan-generate.server.ts`. Provedores com JSON Schema estrito (Groq/OpenAI) rejeitam esse tipo de bound — exatamente a mesma classe de problema já corrigida no fluxo de Importação de Briefing, onde a regra virou "schema simples no wire, limites aplicados em código". A chamada da pauta também não define orçamento de saída explícito nem opções por provedor, o que reproduz o outro modo de falha já visto (`max completion tokens reached before generating a valid document`).

## Correção proposta

1. **Schema de wire simples** (`monthly-plan-generate.server.ts`): remover `.min()/.max()` do array de tópicos no schema enviado ao modelo; a quantidade contratada continua sendo garantida depois, na alocação determinística por vaga (que já existe) e por clamp em código. Nada de cast para esconder erro.
2. **Execução provider-aware** (`monthly-plan-agent.server.ts`): definir orçamento de saída explícito e as opções corretas por provedor (Groq com `reasoningEffort` válido — nunca `"none"`), reaproveitando o mesmo padrão já validado no executor do briefing, sem criar um fluxo paralelo.
3. **Classificação e mensagem honesta**: quando a causa raiz da execução for quota/rate limit do provedor primário, a UI deve dizer isso ("Limite de IA do provedor atingido — tente em alguns minutos ou revise o provedor primário em Conexões"), em vez de `ai_generation_failed`. Preservar o botão "Abrir Conexões" quando o problema é de provedor/chave.
4. **Detecção de truncamento** tratada como falha própria com mensagem clara, sem salvar pauta parcial.
5. **Fallback só para falhas transitórias** (429/5xx/quota) — comportamento atual mantido; 4xx do provedor continua terminal, sem multiplicar custo.
6. **Nada incompleto é salvo**: a garantia atual de não persistir pauta parcial é mantida.

## Fora de escopo

Sem alterações em RBAC/RLS/auth, migrations, schema do banco, tenants/workspaces ou Instalação × Workspace. Sem trocar o provedor configurado pelo usuário e sem usar Cloud AI/gateway.

## Validação

Testes direcionados de geração de pauta (schema sem bounds, clamp em código, classificação de quota/truncamento), suíte completa, typecheck e build. Depois, gerar uma pauta real: se o Gemini estiver em quota, o Groq deve concluir; se ambos falharem, a mensagem deve nomear a causa.

## Observação importante

Independentemente da correção, a chave do Gemini está no **free tier com 20 requisições/dia** já esgotado. Mesmo com o fallback funcionando, o ideal é habilitar cobrança nessa chave ou deixar um provedor com cota real como primário.

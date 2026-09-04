# Corrigir falha da etapa "Construindo cohorts" na geração por IA

## O que aconteceu

Os logs do último preenchimento mostram a sequência real:

```text
[ai-provider] gemini falhou (provider_unavailable) — alternando para groq/openai/gpt-oss-120b
[customer-pipeline] etapa=cohorts FALHOU motivo=invalid_output retryable=false: ai_invalid_output: cohorts sem conteúdo
```

Ou seja: o provedor primário (Gemini) estava indisponível, o fallback (Groq) respondeu
normalmente, mas o conteúdo devolvido não passou pela validação da etapa de cohorts.

A causa está na normalização: `normalizeCohortsPayload` só aceita **texto** nos campos
`behavioral_traits`, `content_strategy` e `conversion_criteria` (usa `asStr`, que devolve
string vazia para qualquer outro tipo). Modelos diferentes descrevem esses campos como
**lista** ou como **objeto aninhado** — nesse caso todos os campos ficam vazios, a
validação `assertValidOutput` dispara "cohorts sem conteúdo" e a etapa é marcada como
falha permanente (sem retry). As etapas anteriores (briefing, voz, personas) já haviam
sido salvas, então o usuário perdeu apenas a estratégia final — mas o erro aparece como
falha genérica.

## O que será corrigido

1. **Normalização tolerante de cohorts** — aceitar, nos campos de texto:
   - string (comportamento atual);
   - array de strings (unir em texto legível);
   - objeto com campos de texto (achatar em texto);
   - mais aliases de chave em PT-BR/EN (ex. `traits`, `perfil_comportamental`,
     `estrategia`, `criterios_de_conversao`, `criterio`).
   `target_personas` também aceita string única convertida em lista.
2. **Mesma tolerância nas outras etapas** (voz, personas, SWOT), pelos mesmos helpers,
   para o problema não reaparecer em outra etapa com outro modelo.
3. **Diagnóstico útil quando ainda faltar conteúdo** — se após a normalização o payload
   continuar vazio, registrar no log as chaves recebidas (sem conteúdo sensível) e
   devolver mensagem mais clara na UI do que "não conseguiu concluir esta etapa".
4. **Retry de uma etapa com output inválido**: permitir uma nova tentativa quando o
   modelo devolve estrutura inesperada (hoje é falha imediata e definitiva), mantendo o
   limite de tentativas existente e sem persistir conteúdo inválido.

## Fora de escopo (não será alterado)

- RBAC, RLS, autenticação, tenants/workspaces, instalação, migrations e schema.
- Substituição do provedor primário, chaves BYOK ou catálogo de modelos.
- Aplicação automática de conteúdo: nada inválido é salvo, e o conteúdo ativo anterior
  do cliente permanece intacto.

## Detalhes técnicos

- Arquivo principal: `src/routes/api/jobs/customer-pipeline.ts`
  (`asStr`/`asArr`, `normalizeCohortsPayload`, `normalizeVoicePayload`,
  `normalizePersonasPayload`, `normalizeSwotPayload`, `assertValidOutput`).
- Classificação de falha em `src/lib/ai-failures.server.ts`: `invalid_output` passa a
  permitir uma retentativa dentro do mesmo limite de tentativas da etapa.
- Testes: novos casos cobrindo cohorts em formato lista, objeto aninhado e aliases
  PT-BR, além do caso genuinamente vazio (que deve continuar falhando).
- Validação final: `npx tsgo --noEmit`, suíte de testes completa e build.

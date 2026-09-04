-- Align the seed system prompts of the two agents currently used by the
-- Monthly Plan pipeline with the runtime variable catalog documented in
-- src/lib/agent-variables.ts. Without these blocks the template
-- substitutions performed at runtime by monthly-plan.ts had nothing to fill,
-- so briefing context never actually reached the model.

UPDATE public.agent_prompts
SET
  system_prompt = system_prompt || E'\n\n══════════════ CONTEXTO DA MARCA (INJETADO EM RUNTIME) ══════════════\n{{CONTEXT}}\n\nPERSONAS ATIVAS:\n{{PERSONAS}}\n\nCONCORRENTES MONITORADOS:\n{{COMPETITORS}}\n\nPALETA PRIMÁRIA: {{PRIMARY_COLORS}}\n\n══════════════ PARÂMETROS DA EXECUÇÃO ══════════════\nQuantidade solicitada: {{QUANTIDADE}} peça(s)\nPeríodo alvo: {{PERIODO}}\nDistribuição por canal (siga estritamente):\n{{CHANNEL_MIX}}\n\nUse estes dados como fonte primária. Não invente informações fora do contexto.',
  default_prompt = COALESCE(default_prompt, system_prompt) || E'\n\n══════════════ CONTEXTO DA MARCA (INJETADO EM RUNTIME) ══════════════\n{{CONTEXT}}\n\nPERSONAS ATIVAS:\n{{PERSONAS}}\n\nCONCORRENTES MONITORADOS:\n{{COMPETITORS}}\n\nPALETA PRIMÁRIA: {{PRIMARY_COLORS}}\n\n══════════════ PARÂMETROS DA EXECUÇÃO ══════════════\nQuantidade solicitada: {{QUANTIDADE}} peça(s)\nPeríodo alvo: {{PERIODO}}\nDistribuição por canal (siga estritamente):\n{{CHANNEL_MIX}}\n\nUse estes dados como fonte primária. Não invente informações fora do contexto.'
WHERE agent_id = 'planner_strategic'
  AND system_prompt !~ '\{\{CONTEXT\}\}';

UPDATE public.agent_prompts
SET
  system_prompt = replace(
    system_prompt,
    '{{CONTEXT}}',
    E'══════════════ CONTEXTO INJETADO EM RUNTIME ══════════════\nTOM DE VOZ / VOICE CARD:\n{{TONE}}\n\nPERSONA PRIMÁRIA:\n{{PERSONA}}\n\nHASHTAGS OFICIAIS: {{HASHTAGS}}\n\nCONCEITO DA PEÇA (JSON):\n{{CONCEPT}}\n══════════════════════════════════════════════════════════'
  ),
  default_prompt = replace(
    COALESCE(default_prompt, system_prompt),
    '{{CONTEXT}}',
    E'══════════════ CONTEXTO INJETADO EM RUNTIME ══════════════\nTOM DE VOZ / VOICE CARD:\n{{TONE}}\n\nPERSONA PRIMÁRIA:\n{{PERSONA}}\n\nHASHTAGS OFICIAIS: {{HASHTAGS}}\n\nCONCEITO DA PEÇA (JSON):\n{{CONCEPT}}\n══════════════════════════════════════════════════════════'
  )
WHERE agent_id = 'copywriter_senior'
  AND system_prompt ~ '\{\{CONTEXT\}\}';

-- Ensure every row has a default_prompt so the "Restaurar padrão" button works.
UPDATE public.agent_prompts
SET default_prompt = system_prompt
WHERE default_prompt IS NULL;
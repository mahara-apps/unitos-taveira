# Briefing não aparece preenchido logo após a análise da IA

O ajuste feito hoje no MASTER faz os campos se atualizarem quando chega uma versão nova do briefing, mas ele depende de um "marcador de última atualização" do cliente. Isso é frágil por dois motivos confirmados agora:

- A gravação do briefing (`briefing-write.server.ts`) não escreve `updated_at`; quem atualiza é o gatilho `trg_clients_updated` do banco. No MASTER o gatilho existe. Se a instalação da Taveira estiver com o mesmo tipo de defasagem de schema que já encontramos em projetos/tarefas, o marcador nunca muda e a tela continua mostrando os campos antigos até limpar o cache.
- A Taveira roda a versão publicada, que ainda não tem a correção de sincronização feita hoje.

## Correção

1. Não depender do marcador de data: a tela passa a comparar o conteúdo do briefing recebido (assinatura do próprio conteúdo) além do `updated_at`. Se o conteúdo mudou, os campos são atualizados na hora — mesmo em banco sem o gatilho.
2. A gravação do briefing passa a escrever explicitamente a data de atualização do cliente, para não depender do gatilho.
3. Ao terminar a importação com IA, além de recarregar, a resposta já aplicada é usada para preencher os campos imediatamente (sem esperar ida e volta), com aviso curto de confirmação.
4. Proteção de edições não salvas continua como está: quando há alterações locais, aparece "Atualizar campos" / "Manter minhas edições".
5. Verificação da instalação da Taveira: conferir se o gatilho de data e as colunas de briefing existem lá e, se faltarem, incluir no delta de migrações usado por instalações (mesmo caminho já usado na correção de projetos), para novas instalações não nascerem defasadas.
6. Publicar a nova versão para a Taveira pelo Installation Manager, já que a correção só chega lá com atualização de código.

## Detalhes técnicos

- `src/components/brand-hub/briefing-workspace.tsx`: `decideBriefingFormSync` recebe também uma assinatura de conteúdo (hash estável do `brand_hub` + campos de identidade); decisão passa a ser `apply` quando conteúdo mudou e não há `dirty`, `prompt` quando há `dirty`.
- `src/lib/briefing-form-sync.ts`: nova entrada `serverSignature`/`syncedSignature` mantendo a mesma API de retorno (`apply` | `prompt` | `keep`); testes atualizados em `tests/briefing-form-sync.unit.test.ts` cobrindo "mesma data, conteúdo diferente".
- `src/lib/briefing-write.server.ts`: incluir `updated_at: new Date().toISOString()` no `update` de `clients`.
- `src/components/brand-hub/briefing-import-dialog.tsx`: manter `onApplied`, sem mudança de lógica de análise/aplicação.
- Verificação do banco da Taveira via credenciais da instalação (read-only primeiro); qualquer objeto faltante entra em `supabase/baseline-snapshot/007_delta_migrations.sql` + manifest, como já feito antes.
- Sem mudanças de RBAC, RLS, prompts ou modelo de dados do briefing.

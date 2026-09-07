# O aviso "7 verificação(ões) com problema" na Taveira

## O que esse aviso realmente é

Não há problema na Taveira. O sistema testa 4 fornecedores de IA (OpenAI,
Anthropic, Google Gemini e Groq) em até 3 funções cada (texto estratégico,
texto operacional e imagem). Quando um fornecedor **não tem chave cadastrada**,
o teste é apenas *ignorado* — mas a mensagem final soma os ignorados junto com
as falhas de verdade.

Na Taveira só o Google Gemini está com chave: sobram exatamente 7 testes
ignorados (OpenAI 3 + Anthropic 2 + Groq 2) — o mesmo número da mensagem.
No painel a única chave existente aparece como válida, confirmando que nada
falhou.

Conferido também: a instalação da Taveira está em `1.2.10`, com estado
`up_to_date` e saúde `healthy`.

Dois efeitos secundários observados no mesmo painel:

1. **"Nunca verificado"** continua aparecendo mesmo depois de clicar em
   "Verificar agora", porque o histórico só recebe registro dos fornecedores
   testados e a data exibida não usa o resultado que acabou de voltar.
2. **O recado do Groq** ("llama-3.3-70b-versatile saiu do ar e foi substituído")
   fica fixo na tela para sempre, mesmo sem chave do Groq configurada e mesmo
   depois de a troca já ter sido feita há dias — parece um alerta atual quando é
   histórico.

E um problema latente encontrado durante a checagem: quando um modelo é
detectado como descontinuado, o registro tenta ser gravado com o estado
"descontinuado", que o banco não aceita (só aceita "ok" e "falhou"). A gravação
falha em silêncio, então esses casos nunca entram no histórico.

## O que será corrigido

1. A contagem final deixa de somar fornecedores sem chave. A mensagem passa a
   ser: "Todos os modelos ativos" quando não há falha, e "X modelo(s) com falha"
   somente quando há falha real; fornecedores sem chave aparecem como
   "N fornecedor(es) sem chave configurada", em tom informativo.
2. "Última verificação" passa a mostrar a data/hora da execução que acabou de
   rodar, sem depender do histórico.
3. Os fornecedores sem chave passam a ser listados no painel com o rótulo
   "sem chave" em vez de ficarem invisíveis — assim fica claro por que o número
   aparecia.
4. O recado de substituição de modelo passa a exibir a data da troca e só
   aparece para fornecedor com chave ativa; deixa de parecer um erro atual.
5. O banco passa a aceitar os estados "descontinuado" e "ignorado" no
   histórico, e a falha de gravação passa a ser registrada em log em vez de
   passar em branco.

## Detalhes técnicos

- `src/lib/ai-models.functions.ts` (`runAiModelHealthNow`): trocar
  `entries.filter(e => e.status !== "ok").length` por contadores separados
  (`problems` = `deprecated|failed`, `skipped`, `replacements`) e devolver
  `checkedAt` já usado pela UI.
- `src/components/connections/ai-center.tsx` (`HealthPanel`): novo texto do
  toast conforme os contadores; `lastCheckedAt` com fallback para o
  `checkedAt` da mutação; listar fornecedores sem chave em estado neutro;
  mostrar `updatedAt` do override no aviso de substituição e filtrar por
  fornecedor conectado.
- Migração nova: substituir o CHECK de `public.ai_model_health.status` por
  `ok|failed|deprecated|skipped` (sem alterar RLS/grants existentes).
- `src/lib/ai-model-health.server.ts`: checar o `error` dos `insert` em
  `ai_model_health` e logar.
- Fechamento MASTER-first: regenerar o pacote de deltas, subir
  `delta_version.txt` e `MASTER_RELEASE_VERSION` para `1.2.11`, cobrir a
  alteração em `supabase/install/verify-installation.sql` se aplicável e rodar
  `bun run master:check`, typecheck e build. Depois: publicar o MASTER e
  autorizar "Atualizar" na Taveira.
- Nada muda em RBAC/RLS, credenciais ou dados da Taveira.

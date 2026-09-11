# Refazer o fluxo de instalação com validação obrigatória por etapa

## Diagnóstico confirmado

A Casa 8 está cadastrada com os três tokens e sem operação presa. A tentativa mais recente terminou corretamente como bloqueada, antes de alterar GitHub, Vercel ou banco.

O token do Supabase alcança o projeto e executa a consulta inicial, mas os endpoints de leitura das chaves publicável e de serviço devolvem acesso negado. Hoje essas chaves são uma dependência obrigatória e só podem ser obtidas automaticamente; por isso o processo não consegue avançar mesmo quando o token pode administrar o banco.

A auditoria também confirmou problemas estruturais no fluxo atual:

- o executor é uma função extensa, com decisões e checkpoints distribuídos;
- algumas etapas comprovam apenas que a chamada respondeu, sem uma pós-validação específica do resultado;
- existem caminhos que tratam falhas de publicação como aviso e continuam;
- o estado de retomada fica em um JSON flexível, sem contrato único por etapa;
- o worker de retomada e o endpoint de progresso não possuem cobertura completa;
- a janela de retomada atual é de 5 segundos, menor que chamadas externas legítimas, permitindo execução concorrente;
- a abertura da operação e a atualização do cadastro ocorrem em gravações separadas;
- atualizações podem ser encerradas como sucesso antes de o build ficar pronto e antes da validação final;
- o script manual ainda possui uma versão fixa diferente da versão canônica do MASTER;
- os testes externos usam respostas simuladas e não formam uma esteira obrigatória por etapa.

## Resultado desejado

Transformar provisionamento, atualização e validação em uma sequência controlada:

```text
Pré-condição → execução → pós-validação → checkpoint → próxima etapa
                         ↘ falhou: encerra e preserva o ponto de retomada
```

Nenhuma etapa será marcada como concluída apenas porque uma API retornou sucesso. Cada uma terá uma evidência verificável e uma regra explícita de avanço.

## 1. Credenciais completas e seguras

- Acrescentar à credencial da instalação dois valores cifrados: chave publicável e chave de serviço do Supabase.
- Adicionar os dois campos seguros na aba de acessos, sem nunca devolver os valores completos à tela.
- Manter a tentativa automática de leitura das chaves.
- Quando o Supabase impedir a revelação automática, usar as chaves informadas no formulário.
- Validar antes de salvar:
  - token: consegue executar `select 1` no Project ref informado;
  - chave publicável: acessa o endpoint público do próprio projeto;
  - chave de serviço: pertence ao mesmo projeto e consegue uma leitura administrativa mínima;
  - nenhuma chave, URL ou Project ref aponta para o MASTER.
- Não permitir misturar token de um projeto com chaves de outro.

## 2. Motor único de etapas

Criar um executor comum para provisionar, atualizar e validar. Cada etapa declarará:

- entradas necessárias;
- se é somente leitura ou se altera algo;
- política de timeout e tentativas;
- ação idempotente;
- pós-condição obrigatória;
- dados não sensíveis que formam o checkpoint;
- mensagem exata de permissão, instabilidade ou inconsistência;
- possibilidade segura de retomada.

Uma etapa só passa para `done` depois da pós-condição. `401/403` encerram imediatamente; `429/502/503/504/timeout` recebem poucas tentativas e encerram como temporários; qualquer resposta inesperada encerra como falha, nunca como sucesso parcial.

## 3. Provisionamento, validado passo a passo

1. **Configuração:** conferir Project ref, URL, repositório, projeto de publicação e isolamento do MASTER.
2. **Acessos:** validar Supabase, GitHub e Vercel sem realizar alterações.
3. **Código:** criar/adotar a cópia do template; comprovar repositório, branch, commit e versão do MASTER.
4. **Publicação conectada:** criar/localizar o projeto Vercel, descobrir a equipe quando necessário, ligar ao repositório correto e reler o vínculo.
5. **Plataforma Supabase:** confirmar projeto, extensões e acesso de consulta.
6. **Banco:** aplicar snapshot/delta em lotes retomáveis; ao final comprovar objetos estruturais, RLS e fila de dependências vazia.
7. **Storage:** aplicar buckets/policies e reler os cinco buckets e suas proteções.
8. **Seeds:** aplicar catálogos e comprovar os registros mínimos esperados.
9. **Secrets e variáveis:** reutilizar secrets próprios já existentes, gravar Vault/Vercel e reler apenas presença/versão, nunca valores.
10. **Build e URL:** disparar publicação Git, aguardar estado `READY`, confirmar commit publicado e resposta HTTP da URL operacional.
11. **Brain:** inicializar e comprovar que a estrutura/materialização responde.
12. **Cron:** agendar somente após a URL estar operacional; reler quantidade, destino e segredo próprio.
13. **Validação final:** executar verificações estruturadas; qualquer `FAIL` bloqueia o registro de versão.
14. **Versão:** gravar release e commit somente quando todas as etapas anteriores tiverem evidência válida.

## 4. Atualização sem lacunas

- Fazer o mesmo preflight completo antes de colocar o ambiente em atualização.
- Fixar release, commit e hash do delta no início; uma retomada nunca muda o alvo no meio do processo.
- Aplicar o delta com checkpoint por lote e pós-validação estrutural.
- Publicar exatamente o commit autorizado, aguardar `READY` e comprovar o commit servido. Push aceito, auto-deploy acionado ou rebuild criado ainda serão estados pendentes, nunca sucesso.
- Rodar a mesma validação final completa do provisionamento antes de atualizar a versão instalada.
- Retirar o aviso de atualização somente após sucesso; em falha, manter o ambiente legível, encerrar a operação e indicar o ponto exato de retomada.

## 5. Retomada, concorrência e operações presas

- Criar uma abertura atômica da operação no banco: trava, operação, status e `active_operation_id` mudam juntos.
- Centralizar provisionar, atualizar e validar na mesma máquina de estados, removendo os três fluxos duplicados de abertura.
- Usar lease com identificador e validade compatível com chamadas externas longas; somente um executor pode assumir cada operação.
- Renovar o heartbeat durante etapas longas.
- Preservar checkpoints concluídos somente quando a evidência ainda for válida; caso contrário, revalidar a etapa.
- Toda saída — sucesso, bloqueio, cancelamento, timeout ou exceção — fecha a operação e libera a instalação.
- O cron de retomada não dependerá da tela aberta.
- Retomar sempre pelo tipo correto: provisionamento, atualização ou validação.

## 6. Tela de acompanhamento

- “Testar acesso” exibirá cada requisito separadamente: banco, chaves do Supabase, repositório/template, gravação no destino, projeto/equipe Vercel e vínculo Git.
- Cada etapa mostrará `Aguardando`, `Validando`, `Concluída`, `Bloqueada` ou `Falhou`, com a evidência segura da última validação.
- Quando faltarem as chaves do Supabase, a própria etapa direcionará para os dois novos campos, sem perder progresso.
- A ação de tentar novamente retomará da primeira etapa sem evidência válida.

## 7. Testes obrigatórios antes da Casa 8

- Testar cada etapa isoladamente com sucesso, 401, 403, 429, 502, 503, 504, timeout e resposta incompleta.
- Testar que nenhuma etapa seguinte é chamada quando a atual falha.
- Testar token válido com revelação negada e chaves manuais válidas.
- Testar rejeição de chaves pertencentes a outro projeto.
- Testar retomada após cada checkpoint e duas retomadas concorrentes.
- Cobrir o worker de retomada, o endpoint de progresso, autenticação do cron e fechamento obrigatório da operação.
- Aplicar o pacote em um banco descartável vazio e em um banco parcialmente atualizado; ambos devem terminar com a mesma estrutura e todas as verificações aprovadas.
- Fazer `finalizeOperation` rejeitar sucesso se existir etapa com erro, pendente ou sem evidência obrigatória.
- Testar que o script manual, o provisionamento automático e a atualização registram a mesma versão canônica lida do pacote/commit, sem valor fixo paralelo.

## 8. Validação real da Casa 8

Após os testes controlados:

1. executar “Testar acesso” real;
2. se a revelação continuar negada, solicitar na própria tela a chave publicável e a chave de serviço da Casa 8;
3. validar e salvar as chaves cifradas;
4. executar o provisionamento real etapa por etapa;
5. interromper no primeiro resultado inválido, corrigir a causa da etapa e repetir somente a partir dela;
6. concluir apenas com repositório/commit, Vercel/`READY`, banco, Storage, secrets, cron, URL e validação final comprovados;
7. registrar o relatório final com o resultado observado de cada etapa, sem expor credenciais.

## Alterações de schema

Na tabela protegida de credenciais da instalação:

- `supabase_publishable_key_ciphertext text null`
- `supabase_service_role_key_ciphertext text null`

As colunas permanecem acessíveis somente ao Super Admin pelas regras atuais, com valores cifrados por AES-256-GCM. Nenhuma chave será armazenada em texto aberto, logs, histórico da operação ou respostas da tela.

Não será criada uma nova tabela de negócio. Os checkpoints e evidências não sensíveis continuarão vinculados à operação, mas passarão a obedecer um contrato tipado e validado.

## MASTER-first

- Aplicar a migration e o novo executor no MASTER.
- Remover a versão fixa do script manual e usar `delta_version.txt`/commit publicado como única autoridade.
- Atualizar a verificação da instalação para cobrir o novo contrato sem exigir que secrets sejam revelados.
- Regenerar delta e manifesto, sincronizar `delta_version.txt` e `MASTER_RELEASE_VERSION`.
- Ampliar os guardiões de completude e rodar `bun run master:check`.
- Publicar o MASTER antes da execução real da Casa 8.

## Fora de escopo

- Nenhuma alteração em módulos operacionais, papéis, clientes, projetos ou integrações sociais.
- Nenhuma redução de RLS, autoridade ou proteção das credenciais.
- Nenhum avanço automático diante de aviso de publicação, schema incompleto ou validação inconclusiva.

# Investigar e evitar o recarregamento que apaga o que está em edição

## O que a varredura já mostrou

Não existe no sistema nenhum temporizador que recarregue a página de tempo em tempo. Só há três lugares que trocam a página inteira, todos intencionais:

- sair da conta (menu do usuário);
- aceitar convite;
- e um caminho de segurança: quando o sistema conclui que a sessão de login não vale mais, ele manda a pessoa para a tela de entrada.

Esse terceiro caminho é o único candidato real dentro do sistema. Ele é acionado sempre que uma chamada ao servidor volta como "não autorizado" e a tentativa de renovar a sessão falha. No preview do Lovable a sessão é intermediada pelo editor por mensagens entre janelas, com um limite de espera de 2 segundos — se essa resposta atrasar, a renovação "falha" mesmo com o login válido, e a pessoa é jogada para a tela de entrada, perdendo o que estava preenchendo. Como várias telas consultam o servidor a cada 60 segundos, isso pode acontecer a qualquer momento, o que combina com o intervalo irregular de 4–5 minutos relatado.

A outra causa possível é o próprio preview: quando o projeto é reconstruído, o preview recarrega a página. Essa parte não é do sistema e não acontece no site publicado.

## O que vamos fazer

1. **Descobrir a causa com certeza.** Registrar, de forma leve, o motivo de cada saída de página (renovação de sessão falhou, ida para a tela de entrada, recarregamento externo do preview) e reproduzir o cenário deixando uma tela aberta com formulário preenchido por alguns minutos. Assim confirmamos se é o sistema ou o ambiente de preview.
2. **Tornar a expulsão para a tela de entrada muito mais tolerante.** Só levar a pessoa para o login depois de várias falhas seguidas e reais (e nunca por causa de um atraso de 2 segundos na resposta do editor). Enquanto isso, tentar renovar em segundo plano com espera crescente e manter a tela como está.
3. **Proteger o trabalho em andamento.** Se ainda assim for necessário pedir login novamente, mostrar um aviso na tela ("sua sessão expirou, entre novamente") em vez de trocar a página na hora, e avisar antes de sair quando houver formulário preenchido.
4. **Confirmar no site publicado** que o comportamento não ocorre lá, e deixar claro para você o que era do preview e o que era do sistema.

## Detalhes técnicos

- `src/start.ts`: no `attachSupabaseAuth`, distinguir "refresh falhou por timeout/rede" de "token rejeitado de fato"; hoje qualquer falha cai em `clearInvalidSession()` + `window.location.replace('/login')`. Introduzir contador de falhas consecutivas + backoff, e trocar o redirect imediato por um evento (`nx:session-expired`) consumido pela UI.
- `src/integrations/supabase/previewAuthStorage.ts` é gerado e não deve ser editado; a tolerância ao timeout de 2s fica do lado do consumidor (start.ts / camada de sessão).
- Consumir `nx:session-expired` num aviso global (ex.: dentro de `src/routes/__root.tsx`) com ação "Entrar novamente", em vez de navegação forçada.
- Guard de saída (`beforeunload`) apenas quando houver alteração não salva em formulários longos (briefing, entrevista de mídia paga, tarefas).
- Instrumentação temporária: log de `beforeunload`/`pagehide` com motivo e do resultado de `refreshSession`, para confirmar a origem antes de remover.
- Sem mudanças de banco, permissões ou regras de negócio.

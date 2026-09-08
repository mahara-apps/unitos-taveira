# Corrigir bloqueio na confirmação de nome do primeiro acesso

## Diagnóstico confirmado

O botão chama a gravação corretamente, mas a tela só fecha quando uma segunda consulta
atualiza o estado `requiresName`. Essa consulta está configurada com cache infinito e,
após salvar, o código apenas solicita a invalidação sem aguardá-la nem atualizar o dado
local. Se a reconsulta atrasar ou mantiver o valor anterior, o nome pode até ser gravado,
mas o modal continua aberto — exatamente o comportamento relatado.

Além disso, a gravação atual não confirma que uma linha do perfil foi realmente alterada:
um update sem linha correspondente pode retornar sem erro e a tela exibe sucesso mesmo
sem ter persistido o nome.

## Correção

1. **Tornar o salvamento verificável no servidor**
   - Atualizar o perfil do usuário autenticado e retornar `id` + `full_name` gravados.
   - Se nenhuma linha for atualizada, retornar erro claro em vez de falso sucesso.
   - Derivar sempre o usuário da sessão; nenhum ID vindo da tela.

2. **Fechar a tela imediatamente após sucesso real**
   - Atualizar diretamente o cache do primeiro acesso com o nome confirmado e
     `requiresName: false` assim que o servidor confirmar a gravação.
   - Em seguida, fazer uma revalidação aguardada em segundo plano para manter servidor e
     tela sincronizados.
   - Desabilitar o botão durante o envio para impedir cliques duplicados.

3. **Melhorar falhas sem prender o usuário silenciosamente**
   - Exibir mensagem amigável persistente no próprio modal se houver falha, mantendo o
     nome digitado para nova tentativa.
   - Registrar contexto técnico no servidor sem expor dados sensíveis.
   - Se a sessão tiver expirado, orientar novo acesso em vez de mostrar erro genérico.

4. **Cobrir ambos os fluxos de primeiro acesso**
   - Usuário que precisa apenas confirmar o nome.
   - Usuário que precisa confirmar nome e trocar a senha temporária.
   - Garantir que o nome salvo não seja perdido se a troca de senha falhar depois.

5. **Validação e propagação MASTER**
   - Testes para sucesso, perfil ausente, sessão inválida, cache antigo e nome + senha.
   - Verificar a experiência nas áreas interna e do cliente, que compartilham o mesmo
     modal.
   - Incorporar junto ao pacote MASTER em andamento, alinhar a próxima versão e executar
     `master:check`, typecheck e build antes de publicar para as instalações.

A implementação não exige mudança de banco nem altera permissões/RLS.

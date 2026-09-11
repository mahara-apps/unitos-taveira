# Convites editáveis e ocultação do administrador MASTER

## Resultado esperado

- Convites pendentes terão ações para **reenviar** e **trocar o e-mail** antes do reenvio.
- O administrador global criado no `/setup` ficará oculto das listas de pessoas e não poderá ser selecionado nem notificado por uma menção.
- Owners comuns de cada workspace continuam visíveis; a ocultação considera exclusivamente a identidade global `is_super_admin`, não o papel `owner` do workspace.

## Implementação

1. **Reenvio seguro do convite**
   - Criar uma ação autenticada para convite pendente que revalide a autoridade do operador e o papel do convite.
   - Ao reenviar, rotacionar o token, renovar a validade e invalidar imediatamente o link anterior.
   - Reutilizar o envio de e-mail e a URL canônica da instalação, retornando erro claro quando o envio não ocorrer.

2. **Troca do e-mail**
   - No mesmo fluxo, aceitar um novo e-mail validado e normalizado, impedindo duplicidade com convite ativo ou conta incompatível.
   - Para conta temporária criada pelo convite, atualizar com segurança a conta vinculada, o perfil e a senha temporária antes do reenvio, preservando o mesmo usuário e o papel escolhido.
   - Para convite de conta já existente, atualizar apenas o destinatário pendente após validar a nova conta e sua elegibilidade.
   - Não permitir alteração de convites aceitos ou revogados.

3. **Ações na tela de equipe**
   - Adicionar ao menu do convite pendente as opções “Reenviar convite” e “Editar e reenviar”.
   - Abrir um modal compacto com o e-mail atual, validação, estado de envio e confirmação do resultado.
   - Atualizar imediatamente a lista, o prazo e o link exibidos após sucesso; manter revogação e cópia de link existentes.

4. **Ocultar o administrador MASTER**
   - Filtrar no servidor todo perfil com autoridade global `is_super_admin = true` nas fontes canônicas de membros, usuários e responsáveis.
   - Aplicar o mesmo filtro às listas usadas por comentários e campos de menção, sem ocultar Owners normais do workspace.
   - Revalidar no servidor as menções recebidas para descartar um ID de Super Admin mesmo se enviado manualmente, evitando também a criação da notificação.

5. **Cobertura e propagação MASTER-first**
   - Testar reenvio, rotação do link, troca de e-mail, conflitos, autoridade e bloqueio de convites encerrados.
   - Testar que Super Admin não aparece em equipe, responsáveis ou sugestões de `@` e não recebe notificação forjada; Owners comuns permanecem visíveis.
   - Se forem necessárias regras/funções no banco, aplicá-las por migration e atualizar a verificação da instalação; depois regenerar o delta, sincronizar a versão do MASTER e executar `bun run master:check`.
   - Validar a tela de equipe e o fluxo autenticado no preview quando a sessão estiver disponível.

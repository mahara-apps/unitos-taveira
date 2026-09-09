# Correção definitiva do primeiro acesso de Lucas Lopes

## Diagnóstico confirmado

- No banco MASTER, `lucas.lopes@sejaumpartner.com` possui conta autenticada, perfil com nome, vínculo ativo como Owner e `requires_password_change = false`.
- A mensagem da captura só é produzida quando o usuário está autenticado, mas a tentativa de atualizar `user_profiles` não encontra uma linha visível para o ID daquela sessão.
- Existe uma falha sistêmica nos convites: `user_profiles.full_name` é obrigatório, porém um dos fluxos cria a conta sem nome. O gatilho tenta inserir `NULL`, captura e ignora o erro; a conta de login nasce sem perfil. Depois, os fluxos administrativos fazem `UPDATE` sem confirmar que uma linha foi alterada.
- O registro atual do MASTER não explica sozinho a sessão da captura. Antes da correção pontual, será confirmado o ambiente/URL efetivamente usado e o ID da sessão do Lucas para evitar reparar o banco errado.

## Implementação

1. **Confirmar e reparar o usuário afetado**
   - Identificar pela URL e pela sessão qual instalação o Lucas está acessando.
   - Conferir, nessa instalação, a correspondência entre conta de login, perfil e vínculo de workspace.
   - Criar/reparar somente o perfil ausente do Lucas, preservando seu papel e vínculos; não recriar a conta nem trocar sua senha sem necessidade.

2. **Autorreparo seguro no primeiro acesso**
   - Alterar o salvamento do nome para, após validar a sessão, criar o perfil quando ele estiver ausente e atualizar apenas `full_name`/e-mail quando já existir.
   - A criação será feita no servidor para o próprio ID autenticado, com papel mínimo no perfil; autoridade continuará vindo do vínculo existente no workspace.
   - Retornar a linha persistida e fechar a janela somente após confirmação real do banco.

3. **Eliminar novas contas órfãs**
   - Centralizar a garantia de perfil em um helper server-side usado por todos os caminhos de criação de usuário da equipe e do portal.
   - Substituir atualizações silenciosas por criação/atualização verificada; se o perfil não puder ser persistido, a criação será tratada como incompleta e não será apresentada como sucesso.
   - Corrigir o gatilho de novo usuário para nunca tentar gravar nome nulo e deixar de ocultar falhas de criação do perfil.
   - Fazer uma reconciliação idempotente de contas existentes sem perfil, sem alterar perfis válidos, papéis ou vínculos.

4. **Experiência e recuperação**
   - Manter o nome digitado em caso de falha e mostrar uma ação clara de tentar novamente.
   - Em sessão inválida, orientar novo login; em inconsistência reparável, corrigir automaticamente sem prender o usuário na janela.
   - Evitar envio duplo enquanto o salvamento estiver em andamento.

5. **Validação**
   - Testar: perfil normal, perfil ausente, nome ausente, sessão expirada, usuário interno e usuário do portal.
   - Executar um primeiro acesso real com uma conta de teste e confirmar que a janela fecha, o painel permanece acessível e o perfil é persistido.
   - Confirmar que Lucas consegue entrar no ambiente correto sem a janela bloqueante.

6. **MASTER-first**
   - Incluir a correção e a reconciliação no pacote MASTER, atualizar a verificação de instalação para detectar contas sem perfil e criar testes de regressão.
   - Regenerar o delta, alinhar a versão do MASTER, executar `master:check`, testes, typecheck e build.
   - Publicar o MASTER e aplicar/validar a atualização na instalação afetada.

## Limites de segurança

- Nenhuma alteração na matriz de papéis ou permissões.
- Nenhuma exclusão/recriação da conta do Lucas.
- Nenhuma senha será lida, exibida ou redefinida sem necessidade explícita.

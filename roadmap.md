# Roadmap

- [x] Adicionar reenvio/edição de convites e ocultar o Super Admin global de listas e menções; sincronizar MASTER.
- [x] Corrigir conclusão prematura do deploy por Git e reconciliar a versão registrada da Casa 8.
- [ ] Publicar o MASTER 1.3.53 com o diagnóstico correto de domínio/modo de teste/permissão no Resend.
- [x] Corrigir a corrida de redirecionamento em `/admin` que causava `Uncaught undefined`; sincronizar MASTER 1.3.54.
- [ ] Corrigir seleção de deployment duplicado da Casa 8, reconciliar a versão comprovada e sincronizar MASTER 1.3.55.
- [x] Publicar o MASTER 1.3.7 e atualizar a Taveira, com validação final.
- [x] Tornar a ação de atualização inequívoca e proteger o reprovisionamento na tela.
- [x] Concluir Lixeira de conteúdos/pipelines com retenção de 30 dias e propagação MASTER.
- [x] Corrigir confirmação de nome no primeiro acesso e validar nos dois portais.
- [x] Dupla confirmação por escrito nas ações de risco do nível master (instalações, exclusões, configurações globais, usuários/permissões) com auditoria em `critical_action_events`. MASTER 1.3.12.
- [x] Corrigir definitivamente contas sem perfil no primeiro acesso, com autorreparo, convites verificados e propagação MASTER 1.3.13.
- [x] Validar o Supabase Access Token contra o projeto e as permissões necessárias antes de salvar/provisionar; propagar no MASTER 1.3.28.
- [x] Acelerar a publicação no GitHub, reaproveitar a árvore do MASTER e tornar atualizações retomáveis; propagar no MASTER 1.3.30.
- [x] Tornar instalações novas template-only, recuperar com segurança repositórios técnicos incompletos e propagar no MASTER.
- [x] Remover a exigência de exclusão na recuperação GitHub: preservar README legado em backup arquivado, com rollback seguro.
- [x] Eliminar também a exigência de renomear repositórios: preservar o legado intacto e criar/registrar automaticamente um destino operacional alternativo.
- [x] Corrigir o vínculo com a Vercel após adoção do template: descobrir automaticamente a equipe dona do projeto e explicar acessos insuficientes.

## 1.3.37 — Casa 8: acessos conferidos antes de publicar
- Cópia do template apenas desatualizada passa a ser sincronizada (antes bloqueava).
- Preflight de publicação/repositório: 401/403/limite = interrompe com a permissão exata; 502/503/504 = temporário.
- Operações sem resposta são encerradas automaticamente (nada fica "em andamento").
- "Testar acesso" informa OK ou a lista exata do que falta.

## 1.3.40 — Instalador stage-gated e BYOK completo
- [x] Aceitar chaves Supabase informadas manualmente quando o token não pode revelá-las.
- [x] Validar Supabase, GitHub e Vercel antes de alterar banco ou publicar código.
- [x] Abrir provisionamento, validação e atualização com lock atômico no banco.
- [x] Exigir build concluído e relatório final aprovado antes de registrar a versão.
- [x] Aumentar a lease e impedir sucesso com etapas pendentes.
- [ ] Publicar o MASTER e executar novamente a Casa 8; bloqueado até autorização externa.

## 1.3.42 — Nome canônico do projeto de publicação
- [x] Reconhecer somente equivalência exata e única entre o nome cadastrado e projetos visíveis na Vercel.
- [x] Corrigir automaticamente `unitos-casa8` para o nome real `unitos-casa-8` após validar o acesso.
- [x] Reutilizar o nome confirmado em todas as etapas seguintes de publicação.
- [ ] Publicar o MASTER e executar “Testar acesso” na Casa 8; depende da sessão do Super Admin.

# Auditoria de telas e do pacote MASTER

## O que a auditoria já verificou (leitura, sem alterar nada)

Mapeei as 85 telas do sistema e cruzei com todos os links e redirecionamentos do código.

**Resultado do mapa de navegação: nenhuma tela quebrada e nenhum link apontando para tela inexistente.**

- Todas as telas internas (Visão, Trabalho, Inteligência, Agência, Configurações, Administração) são alcançáveis pelo menu lateral, pelas abas internas ou pelo perfil do cliente.
- As telas da Área do Cliente (`Início`, `Aprovações`, `Pauta`, `Calendário`, `Briefing`, `Arquivos`, `Minha Marca`, `Pedidos`, `Mensagens`, `Avisos`, `Minha conta`) são montadas por uma lista única de abas, que serve tanto para o acesso com login quanto para o link por token. Aparecem como "sem link" numa busca simples só porque o endereço é montado na hora — estão conectadas.
- Cinco endereços antigos existem apenas como atalho de compatibilidade e já redirecionam para o lugar novo: limites de IA → Centro de IA; identidade visual antiga → Agência/Administração; excedentes → perfil do cliente; SLA → Conteúdo/Colunas; recursos → Administração do Cliente. São intencionais; a recomendação é mantê-los.

## O que está fora de sincronia

1. **Ambiente Taveira está uma versão atrás.** O MASTER está em 1.2.10 (pacote conferido e íntegro); Taveira está em 1.2.9, saudável, mas sem receber a última entrega (reorganização do menu lateral). Falta publicar o MASTER e autorizar a atualização.
2. **Ambiente "unitos-teste" com versão em formato antigo** (`2026.09.0`) e em estado "Atenção". Precisa ser reconciliado ou marcado como descontinuado, para não poluir o painel de instalações.
3. Os testes de integridade do pacote MASTER passam (40 verificações), incluindo a checagem de que toda tabela nova entra no relatório de saúde.

## O que proponho fazer

1. **Reconciliar as instalações**: publicar o MASTER 1.2.10, autorizar a atualização da Taveira e definir o destino do ambiente de teste (atualizar para o formato de versão atual ou arquivar).
2. **Guardião automático de navegação**: criar um teste que percorre todas as telas e reprova se alguma ficar sem caminho de acesso ou se algum link apontar para uma tela que não existe. Isso impede o problema de voltar em entregas futuras.
3. **Registrar os atalhos antigos**: uma pequena lista no código, coberta pelo teste, dizendo que aquelas cinco rotas são redirecionamentos propositais — assim ninguém as remove por engano nem as trata como esquecidas.
4. **MASTER-first**: regenerar o pacote, subir a versão para 1.2.11 e rodar a checagem completa antes de publicar.

## Sobre o usuário de teste

Este projeto usa um Supabase próprio (externo). Nesse modo não consigo criar sessão de teste automática nem navegar autenticado por dentro para conferir tela por tela visualmente. A auditoria acima foi feita sobre o código e o banco reais, que é a fonte confiável. Se você quiser a navegação visual completa, me diga e eu preparo um roteiro de conferência manual, ou você me libera um acesso de teste.

## Detalhes técnicos

- Rotas: 85 arquivos em `src/routes` (fora `api/`), 12 endpoints de serviço em `src/routes/api`.
- Navegação do portal centralizada em `src/components/portal/portal-nav.ts` (fonte única de abas/paths).
- Novo teste em `tests/route-graph.unit.test.ts`: deriva os paths do diretório de rotas, extrai `to:`/`to=` do código, valida os dois sentidos e permite exceções declaradas (redirects legados).
- Sincronia MASTER: `supabase/baseline-snapshot/tools/build_delta.py`, `delta_version.txt`, `MASTER_RELEASE_VERSION` em `src/lib/installation/manager-contract.ts`, `verify-installation.sql`, `bun run master:check`.

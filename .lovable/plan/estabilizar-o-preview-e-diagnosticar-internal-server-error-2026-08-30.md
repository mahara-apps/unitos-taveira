# Estabilizar o preview e diagnosticar “Internal Server Error”

## Diagnóstico confirmado

- A tela enviada ocorreu enquanto o servidor de preview estava recompilando e otimizando dependências, entre **21:02:22 e 21:02:38 UTC**. Durante essa janela, a rota `/dashboard` ficou temporariamente indisponível e o próprio servidor de desenvolvimento respondeu apenas `Internal Server Error`.
- O build mais recente terminou com **build OK** e os logs publicados da última hora não registram erro 500 do dashboard, banco, autenticação ou APIs. Portanto, a imagem não aponta para falha de dados do dashboard nem para indisponibilidade da aplicação publicada.
- O bootstrap atual carrega antecipadamente todos os módulos `*.functions.ts`; isso amplia o trabalho executado em cada reinicialização/recompilação do preview e merece ser reduzido sem reintroduzir erros de registro de server functions.
- Há também uma divergência de hidratação reproduzível no redirecionamento para login. Ela é um problema separado e não explica diretamente a resposta HTTP 500 da imagem, mas deve ser corrigida porque torna a inicialização mais instável.

## Plano de correção

1. **Reduzir o custo de inicialização do servidor**
   - Auditar o registro global de server functions e substituir o carregamento indiscriminado por um registro determinístico apenas dos módulos realmente necessários.
   - Preservar a disponibilidade das funções usadas por rotas com `ssr: false`, evitando regressão de `Invalid server function ID`.

2. **Eliminar a divergência de hidratação observada**
   - Alinhar o fallback inicial e a renderização da rota de login para que servidor e navegador produzam a mesma árvore no primeiro render.
   - Garantir que redirects de sessão expirada não alternem entre pending state e página final durante a hidratação.

3. **Melhorar o diagnóstico de falhas reais**
   - Registrar método, rota, status e um identificador de correlação para respostas 500 capturadas pelo wrapper SSR, sem expor tokens ou dados do usuário.
   - Manter uma tela amigável com ação de recarregar quando a aplicação já estiver inicializada; erros que aconteçam antes do bootstrap continuarão identificáveis pelos logs do preview.

4. **Validar estabilidade**
   - Testar inicialização limpa, atualização por HMR e várias navegações consecutivas para `/dashboard`.
   - Validar sessão válida, sessão expirada e redirecionamento para login.
   - Confirmar ausência de hydration mismatch, respostas 500 e erros de registro de server functions.
   - Rodar typecheck, testes relacionados e build final.

## Escopo preservado

Sem alterações em RBAC, RLS, autenticação, banco, migrations, tenants/workspaces, Instalação × Workspace ou regras de negócio do dashboard.

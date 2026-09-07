# Corrigir versão da Taveira e liberar a atualização

## Sobre a conexão do GitHub (sua pergunta)

Existem duas ligações diferentes com o GitHub, e elas não se substituem:

1. **A conexão do Lovable com o GitHub** (o app `lovable.dev` da sua conta, na sua imagem). Ela serve para sincronizar o código do projeto com o repositório enquanto você desenvolve. Ela pertence ao Lovable, não ao seu sistema — o Unitos em execução não recebe nenhuma credencial dela.
2. **O acesso que o próprio Unitos MASTER usa em tempo de execução** para ler o repositório do MASTER e gravar o código no repositório de cada instalação. Isso acontece dentro do seu sistema, quando você clica em "Autorizar atualização", e só funciona com uma credencial guardada nos secrets do projeto (`UNITOS_GITHUB_TOKEN`).

Ou seja: sim, usamos uma credencial própria, e ela é obrigatória — não é possível reaproveitar a conexão do Lovable para essa etapa. Todo o provisionamento e a atualização das instalações (criar o repositório da instalação, publicar o código autorizado e conferir qual versão está publicada) já dependem dela hoje.

### Caminho exato para gerar essa credencial

1. Acesse: **https://github.com/settings/personal-access-tokens/new** (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token).
2. Em **Resource owner**, escolha **mahara-apps** (a conta dona de `mahara-apps/unitos-master` e dos repositórios das instalações).
3. Em **Repository access**, escolha **All repositories** (o mesmo fluxo cria repositórios novos de instalação).
4. Em **Permissions → Repository permissions**, marque:
   - **Contents: Read and write**
   - **Metadata: Read-only**
   - **Administration: Read and write** (necessário para criar o repositório da instalação a partir do template)
5. Defina a validade, gere o token e copie o valor.
6. Cole no formulário seguro que vou abrir para o secret `UNITOS_GITHUB_TOKEN`. O valor vai direto para o cofre de secrets — não passa pelo chat nem fica no código.

Se preferir não usar um token pessoal, a alternativa é uma conexão de GitHub do próprio Lovable ligada ao projeto, mas ela mudaria a forma como o sistema fala com o GitHub e exigiria reescrever o provisionamento e a atualização das instalações. Não recomendo agora, porque isso mexe justamente na parte que já está funcionando.

## Diagnóstico já confirmado

- A Taveira está realmente no código **1.2.9**, commit **4b11ace**.
- Às **19:53 de 07/09**, uma validação de saúde bem-sucedida gravou indevidamente a versão **1.3.6** e o estado "Em dia", embora nenhum código novo tenha sido enviado. É por isso que a tela volta a mostrar dois números diferentes depois de cada validação.
- A tentativa de atualização anterior foi corretamente bloqueada: o repositório publicado do MASTER ainda continha o pacote 1.2.9.
- O acesso ao repositório do MASTER não está configurado, então o sistema não consegue confirmar qual versão está publicada — e por segurança mantém o botão bloqueado.

## O que será corrigido

1. **Validar deixa de mexer na versão.** A validação continua conferindo banco, regras de acesso, arquivos, agendamentos, site e primeiro acesso, mas nunca mais poderá promover a versão instalada nem declarar "Em dia" sem publicação de código.
2. **Uma única fonte de versão.** Lista, detalhe, selos, filtros e a ação principal passam a usar a versão do código realmente publicado; o número antigo fica apenas como compatibilidade.
3. **Registro da Taveira corrigido** para 1.2.9 com "Atualização disponível", sem tocar em saúde, histórico, credenciais ou dados da operação.
4. **Acesso ao GitHub configurado** conforme o caminho acima, com confirmação real de leitura do repositório antes de liberar o botão.
5. **Proteções automáticas** para que uma validação saudável nunca mais infle a versão e para que o botão continue bloqueado quando a versão publicada não puder ser verificada.
6. **Fechamento MASTER-first:** regenerar o pacote, alinhar a versão do pacote e a do sistema, rodar a checagem completa, os tipos e o build; depois publicar o MASTER e autorizar a atualização.

## Resultado esperado

O painel passa a mostrar um único número verdadeiro: **1.2.9 → nova versão**, com "Atualização disponível". Depois de configurar o acesso, publicar o MASTER e autorizar, a Taveira recebe o código de fato — e só então o número avança e o estado vira "Em dia".

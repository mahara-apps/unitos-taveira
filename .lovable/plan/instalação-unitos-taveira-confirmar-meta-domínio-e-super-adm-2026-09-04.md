# Instalação unitos-taveira: confirmar Meta, domínio e Super Admin no painel

## O que foi verificado agora

Na instalação `unitos-taveira` o provisionamento gravou **17 variáveis** e resolveu a URL operacional como **domínio definitivo** `https://unitos.taveirapublicidade.com.br` (registro da última execução). O domínio salvo no cadastro está como `unitos.taveirapublicidade.com.br`, sem `https://`. A validação final passou com 24 verificações e o registro de saúde está `healthy`, com `super_admin` em "atenção" e a observação "crie o primeiro Super Admin em /setup".

Causas do que aparece na tela:

1. **"Domínio definitivo: Pendente"** — a tela classifica o domínio exigindo um endereço completo com `https://`. Como o cadastro guarda só o host, a classificação falha e cai em "Pendente", mesmo com o domínio já em uso e atribuído ao projeto de deploy.
2. **"Meta: Não configurado"** — o painel nunca consulta nada de Meta: os cinco itens opcionais (Meta, Resend, Evolution, IA, Branding) são exibidos com valor fixo "Não configurado". Só o domínio é calculado. Portanto a tela não reflete que as variáveis do App Meta oficial foram (ou não) enviadas para a instalação.
3. **"Super Admin: Atenção"** — correto por definição: é criado pelo cliente em `/setup` da própria instalação e não bloqueia a operação. Falta apenas deixar isso explícito e acionável na tela.
4. **Versão** — o cadastro tem versão instalada `1.0.0` e versão disponível `2026.09.0`, herdada de antes da troca de numeração; o cartão pode sugerir atualização sem motivo.

## O que será feito

### 1. Conferência real da conexão Meta da instalação
Nova leitura (somente leitura, sem alterar a instalação) que confirma, no projeto de deploy da instalação: presença de `META_APP_ID`, `META_BUSINESS_CONFIG_ID`, `META_REDIRECT_URI` e segredo do App, e se o endereço de retorno bate exatamente com a URL operacional da instalação. Resultado exibido no painel como:
- **Configurado** — App e endereço de retorno coerentes com o domínio;
- **Atenção** — endereço de retorno divergente do domínio (mostra o valor esperado, para cadastro no painel do Meta);
- **Não configurado** — variáveis ausentes.

O mesmo item passa a mostrar qual modo de App está em uso (Unitos oficial ou App do cliente) e o endereço exato a cadastrar em "URIs de redirecionamento válidos".

### 2. Domínio definitivo deixa de aparecer como pendente sem motivo
A classificação passa a aceitar domínio salvo sem `https://` (normaliza para a origem antes de classificar), e o item exibe estado verdadeiro: configurado, aguardando DNS/verificação, ou ausente — com o detalhe da verificação do domínio no projeto de deploy.

### 3. Super Admin e primeiro acesso mais claros
O item de Super Admin ganha rótulo "aguardando primeiro acesso" com link direto para `/setup` da instalação e a indicação de que não impede a operação. Depois que o cliente criar o Super Admin, a validação atualiza para OK.

### 4. Versão coerente
A comparação de versão passa a tratar a numeração antiga (`2026.09.0`) como anterior a `1.0.0`, evitando sugestão de atualização indevida no cartão e no detalhe.

### 5. Ação de conferência no painel
Botão "Conferir integrações" na aba de visão geral que roda a leitura acima (Meta, domínio, e-mail, IA, WhatsApp, branding) e grava o resultado com carimbo de data em pt-BR, sem alterar nada na instalação.

## Detalhes técnicos

- `src/lib/installation/readiness-contract.ts`: `classifyOperationalUrl`/`customDomainState` normalizam host sem esquema; nova função pura para estado do Meta a partir das variáveis observadas + URL operacional (testável, sem rede).
- `src/lib/installation/manager.functions.ts`: nova server fn `inspectInstallationIntegrationsFn` (Super Admin, credenciais da instalação, leitura da lista de env vars do projeto de deploy e do domínio) devolvendo os estados opcionais; persiste em `installations.health_checks` sob chaves próprias, sem tocar no núcleo.
- `src/lib/installation/automation.server.ts`: ao gravar as variáveis, registrar em `health_checks` o resultado de Meta e domínio (inclusive `redirectUri` esperado) para que a tela não dependa de nova conferência.
- `src/routes/_authenticated/admin.instalacoes.$id.tsx`: itens opcionais passam a vir do backend em vez de valor fixo; tooltip com motivo/ação; link para `/setup`; badge de versão usa a comparação corrigida.
- Sem migration: apenas novas chaves dentro do `jsonb` já existente. RBAC inalterado (Super Admin).
- Testes: casos novos em `tests/installation-minimum-operational.unit.test.ts` (domínio sem esquema, estados do Meta) e em `tests/meta-oauth-redirect-uri.unit.test.ts` (redirect esperado por instalação).

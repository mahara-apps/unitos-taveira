# Integração Meta por instalação do Unitos

Cada instalação (agência) tem **domínio próprio + Supabase próprio**. Não existe
Control Plane, gateway nem banco central: tokens, conexões e eventos nunca saem
do Supabase da própria instalação.

Cada instalação escolhe, em **Administração → App Meta** (exclusivo de Super
Admin), qual App Meta ela usa:

| Tipo de App | Quando usar | Credenciais |
| --- | --- | --- |
| **Unitos — App Meta oficial** (padrão) | Instalações operadas com o App Meta central do Unitos | Env: `META_APP_ID`, `META_APP_SECRET`, `META_BUSINESS_CONFIG_ID` |
| **Cliente — App Meta próprio** | O cliente/agência exige o App Meta dele | Gravadas nesta instalação (App Secret cifrado), em Administração → App Meta |

Toda instalação nova inicia em **Unitos — App Meta oficial**. O fluxo "Conectar
Meta" resolve as credenciais automaticamente pelo tipo selecionado — o usuário
final não escolhe nada. Trocar o tipo em uma instalação **não afeta** nenhuma
outra.

## 1. Variáveis de ambiente

Ver `.env.example` na raiz do repositório (lista completa e comentada).

Do App Meta oficial (usadas apenas no modo `unitos`):

```
META_APP_ID=<app id>
META_APP_SECRET=<app secret>
# Config ID de uma configuração de "Facebook Login for Business" DESSE App.
# Não há valor universal: obtenha o seu no App Dashboard.
META_BUSINESS_CONFIG_ID=<config id>
```

Exclusivas de cada instalação (nos dois modos):

```
PUBLIC_APP_URL=https://dominio-da-instalacao
META_REDIRECT_URI=https://dominio-da-instalacao/api/public/meta/callback
META_WEBHOOK_VERIFY_TOKEN=<token único da instalação>
META_STATE_SECRET=<segredo aleatório único da instalação>
BRAND_CREDENTIALS_SECRET=<segredo aleatório único>
CRON_SECRET=<segredo aleatório único>
SUPABASE_* / VITE_SUPABASE_*=<projeto Supabase da instalação>

# opcionais
META_EXTRA_REDIRECT_HOSTS=preview.dominio-da-instalacao
META_WEBHOOK_PEERS=https://outra-instalacao.com,https://terceira-instalacao.com
```

Quando o App oficial é compartilhado entre instalações, `META_APP_SECRET`
também é compartilhado; por isso o `state` do OAuth é assinado com
`META_STATE_SECRET`: um `state` emitido pela instalação A não é válido na B.

## 2. Modo "Unitos — App Meta oficial" (padrão)

1. Definir `META_APP_ID`, `META_APP_SECRET` e `META_BUSINESS_CONFIG_ID`.
2. No App Dashboard do App oficial, registrar o **Redirect URI** e o
   **App Domain** desta instalação (seção 4).
3. Nada a fazer em Administração → App Meta: o padrão já é `unitos`.

Sem `META_BUSINESS_CONFIG_ID` o consentimento cai no modo legado (apenas
`scope`), que normalmente expõe só Páginas em que o usuário é admin direto —
sem seleção de Business Portfolio.

## 3. Modo "Cliente — App Meta próprio"

Em **Administração → App Meta**, o Super Admin seleciona "Cliente — App Meta
próprio" e informa:

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| **App ID** | Sim | App Meta do cliente |
| **App Secret** | Sim | Gravado cifrado (AES-256-GCM) com `BRAND_CREDENTIALS_SECRET`; nunca é devolvido em claro |
| **Config ID** (Facebook Login for Business) | Recomendado | Sem ele, o consentimento do App do cliente cai no modo legado |

Regras:

- salvar em modo `client` sem App ID **e** App Secret é rejeitado;
- neste modo `META_APP_ID`, `META_APP_SECRET` e `META_BUSINESS_CONFIG_ID` são
  ignorados — não há fallback silencioso para o App oficial. Credenciais
  incompletas ou segredo indecifrável produzem erro acionável em pt-BR;
- alterar `BRAND_CREDENTIALS_SECRET` depois de salvar invalida o segredo
  gravado: informe o App Secret novamente.

No App Dashboard **do cliente**, registrar:

- **Facebook Login → Valid OAuth Redirect URIs**:
  `https://<domínio da instalação>/api/public/meta/callback`
- **App Domains**: `<domínio da instalação>`
- Se usar webhooks: **Callback URL**
  `https://<domínio da instalação>/api/public/meta/webhook` com o
  `META_WEBHOOK_VERIFY_TOKEN` desta instalação.
- Criar uma configuração de **Facebook Login for Business** e usar o Config ID
  dela no campo acima.

### Voltar para "Unitos — App Meta oficial"

Basta selecionar "Unitos — App Meta oficial" em Administração → App Meta e
salvar: o App oficial (env) volta a valer imediatamente. As credenciais do
cliente permanecem gravadas (cifradas), apenas deixam de ser usadas — trocar de
volta não exige redigitar nada. Conexões já autorizadas pelo outro App precisam
ser reconectadas em **Canais**.

## 4. App Dashboard (App oficial compartilhado)

- **Facebook Login → Valid OAuth Redirect URIs**: adicionar
  `https://<domínio>/api/public/meta/callback` de **cada** instalação.
- **App Domains**: adicionar o domínio de cada instalação.
- **Webhooks (Page / Instagram) → Callback URL**: a Meta aceita **uma URL por
  produto**. Aponte para a instalação "principal":
  `https://<domínio principal>/api/public/meta/webhook`, com o
  `META_WEBHOOK_VERIFY_TOKEN` dessa instalação.
- **Data Deletion / Deauthorize**: também uma URL só; aponte para a instalação
  principal (a limpeza nas demais continua sendo por instalação).

## 5. Webhook: forward entre instalações

```
Meta → https://principal/api/public/meta/webhook
        ├─ assina válida? (X-Hub-Signature-256 + App Secret em uso)
        ├─ entry[].id encontrado em social_connections local → brain_events (Supabase local)
        └─ entry[].id desconhecido → repassa o body cru + assinatura para META_WEBHOOK_PEERS
                                     → cada peer revalida a assinatura e resolve no SEU Supabase
```

Garantias:

- destino vem **apenas** de `META_WEBHOOK_PEERS` (infra), nunca do request → sem SSRF;
- só origens `https://` absolutas, sem credenciais; a própria origem é descartada;
- o body cru e o header de assinatura são preservados — o peer revalida;
- header `x-unitos-meta-forward: 1` impede loops (uma instalação nunca repassa uma cópia);
- timeout de 4 s por peer, falhas apenas logadas — a Meta sempre recebe 200;
- nenhum token, cookie ou credencial Supabase é enviado no forward;
- um evento sem `entry[].id` reconhecido em nenhuma instalação é simplesmente descartado.

Se webhooks não forem usados no produto, basta não definir `META_WEBHOOK_PEERS`.

## 6. Nova instalação (checklist)

1. Novo domínio + novo projeto Supabase (rodar migrations do repo).
2. Copiar `.env.example` e preencher: Supabase, `PUBLIC_APP_URL`,
   `META_REDIRECT_URI`, `META_WEBHOOK_VERIFY_TOKEN` e os segredos únicos
   (`META_STATE_SECRET`, `BRAND_CREDENTIALS_SECRET`, `CRON_SECRET`).
3. Escolher o tipo de App Meta:
   - **Unitos (padrão)**: definir `META_APP_ID`, `META_APP_SECRET`,
     `META_BUSINESS_CONFIG_ID` (seção 2). Nada a configurar na UI.
   - **Cliente**: Super Admin acessa **Administração → App Meta**, seleciona
     "Cliente — App Meta próprio" e informa App ID, App Secret e Config ID
     (seção 3).
4. Registrar Redirect URI e App Domain da instalação no App Meta em uso
   (oficial ou do cliente).
5. Se usar webhooks: acrescentar a origem da nova instalação em
   `META_WEBHOOK_PEERS` da instalação que possui a Callback URL (e vice-versa se
   houver mais de um sentido).
6. Conectar as contas Meta da agência normalmente em **Canais** e conferir em
   Administração → App Meta que o modo exibido é o esperado.

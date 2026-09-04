# Checklist — nova instalação Unitos (do zero até o provisionamento)

Documento operacional. Serve para abrir uma instalação Unitos independente
(agência/cliente) partindo do MASTER. Ordem importa: cada bloco só começa
quando o anterior estiver "verde".

Glossário rápido:

- **MASTER** — a instalação que administra as demais (`UNITOS_INSTALLATION_ROLE=master`).
  É o único lugar onde existe o módulo *Administração → Instalações*.
- **Instalação** — projeto independente: repositório próprio, deploy próprio,
  Supabase próprio, secrets próprios. Nada é compartilhado com o MASTER, com
  a única exceção do App Meta oficial do Unitos (opcional).
- **Provisionamento** — a rotina automática que o MASTER dispara para aplicar
  banco, storage, seeds, secrets, cron, deploy e validação final no destino.

---

## Bloco 0 — Pré-requisitos no MASTER (uma única vez)

Sem isso o botão de provisionar aparece **BLOCKED**, nunca "sucesso".

| Item | Onde | Observação |
| --- | --- | --- |
| Papel MASTER | variável `UNITOS_INSTALLATION_ROLE=master` | em `client` o módulo é desligado |
| Token de gestão Supabase | secret `UNITOS_SUPABASE_MANAGEMENT_TOKEN` | Supabase → Account → Access Tokens |
| Token de deploy | secret `UNITOS_VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| Time/escopo do deploy | secret `UNITOS_VERCEL_TEAM_ID` | obrigatório quando o projeto vive num Team |
| Repositório de referência | secret `UNITOS_MASTER_REPO` (`org/repo`) | é o código que será publicado nas instalações; precisa estar marcado como **template** no GitHub |
| Token do GitHub | secret `UNITOS_GITHUB_TOKEN` | cria o repositório da instalação a partir do template e publica o código |
| URL do MASTER | `PUBLIC_APP_URL` | usada pelo destino para reportar progresso |

Regras que o sistema aplica sozinho e que **não** devem ser contornadas:

- o MASTER usa credenciais de gestão **próprias**; nenhum secret operacional
  do MASTER é copiado para a instalação;
- qualquer plano de variáveis que aponte para o domínio/Supabase do MASTER é
  recusado;
- `CRON_SECRET`, `BRAND_CREDENTIALS_SECRET`, `META_STATE_SECRET` e
  `META_WEBHOOK_VERIFY_TOKEN` são **gerados** para a instalação. Reaproveitar
  valor do ambiente só é possível com declaração explícita em
  `UNITOS_INSTALL_SECRETS`, e nunca a partir do próprio MASTER.

---

## Bloco 1 — Git (repositório da instalação)

Cada instalação tem o **seu próprio repositório**. Ele não precisa existir
antes: o provisionamento cria a partir do template do MASTER, na primeira
etapa de código, e publica ali a versão autorizada.

1. Definir onde o repositório da instalação vai morar (conta/organização e
   nome) e informar essa URL no cadastro — é ela que o provisionamento usa.
2. Garantir que `UNITOS_GITHUB_TOKEN` tem permissão de criar repositório nessa
   conta/organização e que o token de deploy consegue ler o repositório.
3. **Desligar auto-deploy por Git na instalação.** Instalações externas não
   atualizam sozinhas: cada atualização é autorizada no MASTER, com commit
   fixado (SHA), no card *Versão e atualizações*.
4. Anotar a URL do repositório — ela vai no cadastro da instalação.

Conferir antes de seguir:

- [ ] repositório acessível pelo token de deploy
- [ ] branch de referência definida (`main`)
- [ ] auto-deploy por Git desabilitado no projeto de deploy da instalação

---

## Bloco 2 — Projeto de deploy (Vercel)

1. Criar o projeto de deploy da instalação (nome exclusivo, sem reaproveitar o
   projeto do MASTER).
2. Se houver Team, confirmar que é o mesmo Team de `UNITOS_VERCEL_TEAM_ID`.
3. Não preencher variáveis manualmente: o provisionamento grava o conjunto
   completo. Preencher à mão gera divergência.
4. Anotar o **nome do projeto de deploy** — ele vai no cadastro.

Conferir:

- [ ] projeto criado e vazio de variáveis
- [ ] projeto dentro do escopo do token
- [ ] domínio definitivo em mente (pode entrar depois; a URL temporária serve
      para começar)

---

## Bloco 3 — Projeto Supabase da instalação

O MASTER **não cria** o projeto Supabase: ele opera sobre um projeto que já
existe. Criar antes:

1. Criar o projeto no **mesmo escopo/organização** do token de gestão. Se o
   projeto estiver em outra organização, o provisionamento devolve
   `HTTP 403 ... does not have the necessary privileges`.
2. Região: preferir a mais próxima do público (Brasil → South America).
3. Guardar a senha do banco no gerenciador de senhas do operador; ela não é
   enviada ao MASTER.
4. Confirmar as extensões necessárias: `vector`, `pg_net`, `pg_cron`,
   `supabase_vault`, `pgcrypto`.
5. Anotar a **URL do Supabase** e o **project ref**.

Conferir:

- [ ] projeto na mesma organização do token de gestão
- [ ] extensões disponíveis
- [ ] URL e project ref anotados

---

## Bloco 4 — Cadastro no MASTER

Em *Administração → Instalações → Cadastrar*, informar:

- nome da instalação;
- domínio (definitivo, ou a URL temporária do deploy no início);
- URL do Supabase e project ref;
- URL do repositório;
- nome do projeto de deploy.

O cadastro guarda **apenas metadados** — nenhum segredo. A tela recusa valores
que apontem para o MASTER e hosts inválidos.

Conferir:

- [ ] etapa "Cadastro" concluída no histórico
- [ ] nenhum campo apontando para domínio/Supabase do MASTER

---

## Bloco 5 — Variáveis aplicadas pelo provisionamento

Gravadas automaticamente no projeto de deploy. Listadas aqui para auditoria,
não para digitação:

| Variável | Origem |
| --- | --- |
| `PUBLIC_APP_URL`, `VITE_PUBLIC_APP_URL` | URL operacional da instalação |
| `SUPABASE_URL`, `VITE_SUPABASE_URL` | Supabase da instalação |
| `SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PROJECT_ID` | project ref |
| `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY` | chave publicável do destino |
| `SUPABASE_SERVICE_ROLE_KEY` | chave de serviço do destino (sensível) |
| `CRON_SECRET` | gerado para a instalação |
| `BRAND_CREDENTIALS_SECRET` | gerado para a instalação |
| `META_STATE_SECRET` | gerado para a instalação |
| `META_WEBHOOK_VERIFY_TOKEN` | gerado para a instalação |
| `META_APP_ID`, `META_APP_SECRET`, `META_BUSINESS_CONFIG_ID`, `META_REDIRECT_URI` | opcional: App Meta oficial do Unitos + callback da própria instalação |

Chaves de IA (Gemini/OpenAI/etc.) e envio de e-mail (Resend) são
**configuração posterior**, feita dentro da própria instalação por quem a
opera. Não bloqueiam o provisionamento.

---

## Bloco 6 — Rodar o provisionamento

Sequência das nove etapas, na ordem em que aparecem na tela:

```text
01 Supabase destino       projeto, chaves e extensões
02 Código no GitHub       repositório da instalação criado do template + versão publicada
03 Deploy conectado       projeto ligado ao repositório da instalação, auto-deploy Git desligado
04 Secrets próprios       gerados e exclusivos
05 Variáveis + publicação variáveis gravadas, build e URL operacional
06 Banco + RLS + funções  baseline completo
07 Storage                buckets e policies
08 Seeds de catálogo      catálogo, sem dado de negócio
09 Brain stats            view inicial
10 Cron na própria origem agendado na URL da instalação
11 Validação final        verify-installation.sql
```

Comportamento esperado:

- o provisionamento é **idempotente**: pode ser repetido após corrigir uma
  causa, sem duplicar dados;
- falta de credencial ou de acesso externo nunca vira sucesso — aparece como
  **BLOCKED** com o motivo;
- a operação mantém progresso, então uma repetição retoma do ponto correto.

Conferir:

- [ ] onze etapas concluídas
- [ ] operação sem BLOCKED/erro no histórico

---

## Bloco 7 — Validação e primeiro acesso

1. Rodar **Validar** no MASTER: ele lê o estado real do destino (isolamento do
   Supabase, contagens do baseline, RLS/funções/triggers, buckets e policies,
   cron e URL própria).
2. Abrir a URL da instalação em `/setup` e criar o **Super Admin**.
3. Criar o **workspace único** da instalação.
4. Rodar **Validar** outra vez: com núcleo comprovado, super admin e workspace,
   a etapa "Pronto" fica verde.

Conferir:

- [ ] validação com núcleo comprovado
- [ ] Super Admin criado
- [ ] workspace único criado
- [ ] etapa "Pronto" verde no card da instalação

---

## Bloco 8 — Configuração opcional (não bloqueia)

Cada item aparece na lista recolhível *Configurações opcionais* da instalação:

- domínio próprio (enquanto isso a URL temporária opera normalmente);
- integração Meta (App oficial do Unitos ou App próprio do cliente);
- envio de e-mail (Resend);
- WhatsApp (Evolution);
- credenciais de IA do workspace;
- identidade visual/branding.

---

## Bloco 9 — Problemas mais comuns

| Sintoma | Causa provável | Correção |
| --- | --- | --- |
| `HTTP 403 ... does not have the necessary privileges` na etapa 01 | token de gestão sem acesso à organização do projeto Supabase | recriar o token na conta/organização dona do projeto, ou mover o projeto para o escopo correto |
| Provisionamento **BLOCKED** antes de começar | falta `UNITOS_SUPABASE_MANAGEMENT_TOKEN`, `UNITOS_VERCEL_TOKEN` ou `UNITOS_GITHUB_TOKEN` no MASTER | cadastrar os secrets e repetir |
| Etapa "Código no GitHub" bloqueada | repositório do MASTER não é template, ou o token não pode criar repositório nessa conta | marcar o MASTER como template e revisar o escopo do `UNITOS_GITHUB_TOKEN` |
| Etapa de deploy falha ao ligar o repositório | token sem acesso ao repositório, ou Team divergente | revisar acesso e `UNITOS_VERCEL_TEAM_ID` |
| Plano de variáveis recusado | algum campo do cadastro aponta para o MASTER | corrigir domínio/Supabase/project ref |
| Secret recusado com "herança do MASTER não é permitida" | valor herdado do ambiente sem declaração | deixar o valor em branco para ser gerado |
| Cron não dispara na instalação | URL operacional errada ou `CRON_SECRET` divergente | repetir o provisionamento após corrigir a URL |
| Instalação aparece desatualizada logo após validar | versão registrada é anterior à do MASTER (`v1.0.0`) | autorizar a atualização no card *Versão e atualizações* |

---

## Resumo em uma página

```text
MASTER pronto (tokens UNITOS_*)
   └─ repositório definido, auto-deploy Git desligado
        └─ projeto de deploy criado (sem variáveis)
             └─ projeto Supabase criado na organização do token
                  └─ cadastro no MASTER (só metadados)
                       └─ provisionar (11 etapas, idempotente:
                          código → deploy conectado → variáveis → banco)
                            └─ validar
                                 └─ /setup: Super Admin + workspace
                                      └─ validar de novo → "Pronto" verde
                                           └─ opcionais: domínio, Meta, e-mail, WhatsApp, IA, branding
```

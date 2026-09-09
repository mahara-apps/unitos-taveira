# Briefing imediato para cliente novo

## Problema

Hoje o atalho de briefing rápido existe, mas só aparece quando o cliente é criado pelo
cadastro rápido (gaveta lateral). Quando o cliente é criado pelo assistente completo,
o final oferece "Abrir perfil do cliente" ou "Configurar Brand Hub" — nenhum dos dois
abre o preenchimento rápido de briefing. E na lista de clientes não existe nenhum aviso
de "cliente sem briefing", então só se descobre entrando no cliente e abrindo a aba.

## O que vai mudar

1. **Ao terminar de criar um cliente** (nos dois caminhos: cadastro rápido e assistente
   completo), o botão principal passa a ser "Preencher briefing agora" e abre direto o
   preenchimento rápido de briefing daquele cliente. Os outros destinos continuam
   disponíveis como opções secundárias.

2. **Aviso de cliente sem briefing na lista de clientes**: cada cliente sem briefing
   ganha um selo "Sem briefing" com ação "Preencher" que leva direto ao formulário
   resumido, sem precisar navegar por abas.

3. **Resumo no topo da lista**: quando houver clientes sem briefing, aparece uma faixa
   discreta do tipo "3 clientes sem briefing" com filtro rápido para mostrar só eles.

4. **Rota resumida estável**: o preenchimento rápido continua sendo a mesma tela curta
   já existente (perguntas essenciais + importar com IA), agora acessível por um
   endereço direto que pode ser aberto de qualquer aviso ou notificação.

Nada é removido: a aba de briefing completa, o Cérebro da Marca, a importação com IA e
o portal do cliente continuam funcionando igual.

## Detalhes técnicos

- `new-customer-wizard.tsx`: passo final navega para `/customers/$customerId` com
  `search: { onboarding: "1" }` (mesmo contrato já usado por
  `quick-create-customer-drawer.tsx`), mantendo os botões atuais como secundários.
- `customers.$customerId.tsx`: mantém o auto-open de `?onboarding=1` e o `setActiveTab("briefing")`
  já existentes; nenhuma mudança de lógica de dados.
- `customers.index.tsx`: passa a ler completude/status de briefing dos clientes listados e
  usa `buildBriefingAlert` / `isBriefingConcluded` (`src/lib/briefing-alert.ts`) como fonte
  única — sem nova regra de negócio. Selo + link `to: "/customers/$customerId", search: { onboarding: "1" }`.
- Se a consulta atual da lista não trouxer `briefing_status` / campos do `brand_hub`,
  estender a leitura existente (mesma função de servidor, mesmas políticas/RLS) em vez de
  criar endpoint novo.
- Sem migração de banco, sem alteração de permissões, RLS ou papéis.

## MASTER-first

Regenerar o pacote (`build_delta.py`), alinhar `delta_version.txt` e
`MASTER_RELEASE_VERSION`, rodar `bun run master:check`, typecheck e build antes de encerrar.

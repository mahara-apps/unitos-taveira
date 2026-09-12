# Padronização completa de idioma, datas e horários em PT-BR

## Objetivo

Padronizar todo conteúdo destinado a pessoas no Unitos para português do Brasil, com:

- datas absolutas em `DD/MM/AAAA`;
- horários absolutos em `HH:MM:SS`;
- fuso oficial `America/Sao_Paulo`;
- expressões relativas preservadas quando agregam contexto, como “Hoje”, “Amanhã” e “há 2 horas”;
- aplicação no painel, portais, páginas públicas, e-mails, WhatsApp, notificações, relatórios e arquivos exportados.

Valores técnicos continuarão em UTC/ISO onde o sistema, banco, navegador ou integrações exigem esse contrato.

## Diagnóstico confirmado

- O calendário compartilhado usa o idioma padrão do navegador em parte da formatação, podendo mostrar meses fora de PT-BR.
- Há dois textos visíveis em inglês no briefing público: erro de envio e placeholder de tom personalizado.
- Existem mais de 200 usos relacionados a datas/horas, com formatos como `dd MMM`, `dd/MM`, `HH:mm` e `toLocaleString` sem fuso explícito.
- O formatador central atual usa PT-BR e Brasília, mas ainda omite segundos.
- Alguns calendários e agrupamentos calculam o dia pelo fuso local do navegador, enquanto a regra oficial do produto é Brasília.
- Inputs nativos de data/hora exibem conforme o navegador e armazenam valores técnicos como `YYYY-MM-DD`/`HH:MM`; trocar esses valores quebraria o contrato do próprio HTML.
- Ordenações e filtros já usam timestamps/ISO na maior parte dos fluxos; isso deve permanecer separado da apresentação.

## Implementação

### 1. Criar uma fonte única de formatação humana

- Ampliar os utilitários de data/hora existentes para cobrir, no fuso de Brasília:
  - data completa: `DD/MM/AAAA`;
  - hora completa: `HH:MM:SS`;
  - data e hora: `DD/MM/AAAA HH:MM:SS`;
  - nomes de mês e dia da semana em PT-BR;
  - rótulos relativos já adotados pelo produto.
- Tratar valores inválidos e ausentes de forma uniforme, sem lançar erro na tela.
- Distinguir explicitamente timestamps de “datas puras” para impedir deslocamento indevido de dia.

### 2. Corrigir calendários e seletores

- Fixar `pt-BR` no calendário compartilhado, inclusive dropdowns, acessibilidade, nomes de meses e dias.
- Fazer grades mensal/semanal, calendário de tarefas, calendário editorial e calendários dos portais respeitarem Brasília ao agrupar itens por dia.
- Exibir datas completas nos detalhes, listas e popovers; manter números compactos somente nas células da grade, onde o contexto de mês/ano já está visível.
- Substituir ou encapsular inputs nativos quando necessário para garantir apresentação `DD/MM/AAAA` e `HH:MM:SS`, preservando os valores ISO exigidos pelos controles e pelo banco.
- Habilitar segundos nos campos em que o usuário informa horário; horários anteriormente definidos apenas até o minuto serão apresentados com `:00`.

### 3. Padronizar todas as superfícies do sistema

- Migrar formatos dispersos no painel, clientes, projetos, tarefas, conteúdos, calendário, Brain, analytics, configurações, instalação e auditoria para os formatadores centrais.
- Aplicar a mesma regra aos dois portais, links públicos, aprovações, briefing e recuperação/configuração de conta.
- Corrigir os textos em inglês confirmados no briefing público e revisar mensagens, placeholders, tooltips, estados, dias e meses para impedir conteúdo não PT-BR.
- Padronizar e-mails, WhatsApp, notificações, templates renderizados, páginas públicas, relatórios e exportações destinados a leitura humana.
- Em arquivos exportados que possam ter consumo automatizado, manter uma coluna técnica ISO separada quando necessário e adicionar a coluna humana no padrão solicitado, evitando quebra de integração ou ordenação.

### 4. Preservar contratos e regras de negócio

Não alterar:

- armazenamento de timestamps em UTC;
- payloads ISO de APIs e funções internas;
- valores de inputs HTML exigidos pelo navegador;
- chaves `YYYY-MM-DD` usadas internamente em agrupamentos, filtros e consultas;
- cálculos de intervalos inclusivos;
- casos de “data pura” que usam UTC deliberadamente, como mapas de horas por dia;
- ordem cronológica baseada em timestamp/ISO.

A conversão para `DD/MM/AAAA HH:MM:SS` ocorrerá apenas na entrada/saída humana, nunca como base de comparação ou persistência.

## Proteção contra regressões

- Ampliar testes do fuso oficial para data, hora e data/hora completas, incluindo virada do dia em UTC versus Brasília.
- Testar datas inválidas, segundos, ano completo, calendário em PT-BR e agrupamento correto perto da meia-noite.
- Cobrir campos de agendamento, datas puras, filtros inclusivos, portal, exportações e textos atualmente em inglês.
- Criar um guardião automatizado para impedir novos formatadores locais sem locale/fuso e novas strings visíveis conhecidas em inglês, com exceções documentadas para termos técnicos e nomes próprios.
- Executar testes focados, suíte relevante, verificação de tipos, build, checagem de diferenças e `master:check`.
- Validar visualmente desktop e mobile nas telas principais e nos dois portais, incluindo calendário, formulários com data/hora e bordas de virada de dia.

## Fechamento MASTER-first

1. Aplicar toda a correção no MASTER.
2. Incluir migration apenas se houver dado/configuração persistida que realmente precise mudar; mudanças somente de apresentação não criarão alteração desnecessária no banco.
3. Regenerar o pacote com `build_delta.py`.
4. Subir a versão do MASTER e sincronizar `delta_version.txt` com o novo SHA.
5. Atualizar `verify-installation.sql` se alguma estrutura nova for criada.
6. Executar `bun run master:check` e todos os guardiões de instalação.
7. Publicar o MASTER pelo fluxo Git.
8. Autorizar a atualização de cada instalação pelo fluxo Git-first.
9. Para cada ambiente, aguardar deployment Git com o SHA exato em estado `READY`, executar a validação final e somente então registrar a nova versão.
10. Confirmar que todas as instalações ficaram atualizadas, saudáveis, sem operação pendente e sem aviso de manutenção residual. Falhas ficarão abertas com o ambiente e o bloqueio identificados; nenhum ambiente será marcado como atualizado sem comprovação.

## Critérios de aceite

- Nenhum texto visível auditado permanece fora de PT-BR, exceto nomes próprios e termos técnicos intencionais.
- Datas absolutas destinadas a pessoas aparecem como `DD/MM/AAAA`.
- Horários absolutos destinados a pessoas aparecem como `HH:MM:SS`.
- “Hoje”, “Amanhã” e tempos relativos continuam disponíveis onde já ajudam a leitura.
- Calendários não dependem do idioma ou fuso do navegador para seus rótulos e agrupamentos.
- Banco, APIs, filtros, ordenação, agendamentos e integrações mantêm UTC/ISO e o comportamento atual.
- MASTER e todas as instalações terminam na mesma nova versão, com deployment Git `READY` e validação aprovada.

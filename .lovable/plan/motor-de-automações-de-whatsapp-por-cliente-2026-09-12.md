# Motor de automações de WhatsApp por cliente

## Objetivo
Criar uma feature opcional de automações de WhatsApp, desativada por padrão e habilitada exclusivamente pelo Super Admin. Cada cliente terá um destino padrão — número ou grupo — e Owners/Admins poderão configurar, ativar, pausar e acompanhar seus disparos.

## Experiência no perfil do cliente
- Adicionar a aba canônica **Automações** ao perfil do cliente, visível somente quando a feature `automations` estiver habilitada.
- Exibir no topo o destino padrão do cliente, permitindo escolher um telefone ou grupo já validado pela conexão WhatsApp.
- Criar um painel compacto com lista, estado, próximo disparo, último resultado e ações de criar, editar, duplicar, pausar e excluir.
- Usar um formulário guiado para configurar nome, gatilho, horário, conteúdo, variáveis, links e ativação.
- Permitir apenas Owner e Admin nas ações de gestão; demais papéis não poderão alterar nem ativar regras.
- Incluir histórico por automação com horário, tentativa, destino mascarado, resultado e erro amigável.

## Gatilhos da V1
1. **Data e hora fixa:** um disparo único no instante configurado.
2. **Recorrente:** diário, semanal, mensal ou anual, com dias/horários configuráveis.
3. **Eventos do sistema:**
   - aprovações: aguardando aprovação, aprovado e ajustes solicitados;
   - tarefas e prazos: atribuição, prazo próximo, vencimento e atraso;
   - publicações: agendada, publicada e falha de publicação;
   - portal e briefing: acesso/convite, solicitação e pendência.
4. **Datas do cliente:** datas existentes no sistema e datas personalizadas cadastradas no próprio painel.

Eventos e datas serão enviados no horário exato definido, sem sequências ou antecipações nesta versão.

## Conteúdo e variáveis
- Editor de texto para WhatsApp com links clicáveis e inserção de variáveis por seletor.
- Reutilizar o catálogo e a renderização estrita existentes, ampliando o contexto para marca, cliente, evento, tarefa, publicação, portal, briefing, data e links aplicáveis.
- Mostrar prévia antes de salvar e bloquear a ativação quando houver variável inválida, destino ausente ou conexão indisponível.
- Sem mídia, botões interativos ou listas na V1.

## Motor e confiabilidade
```text
Regra ativa ou evento
        ↓
Ocorrência única e deduplicada
        ↓
Fila persistente com horário de execução
        ↓
Worker protegido → serviço WhatsApp existente
        ↓
Sucesso ou nova tentativa → histórico → aviso final
```
- Manter regras, ocorrências e tentativas em estruturas separadas, sempre com workspace e cliente explícitos.
- Gerar uma chave idempotente por regra/evento/instante para impedir envio duplicado, inclusive após reinício ou concorrência.
- Usar claim com lease para que somente um worker processe cada ocorrência.
- Reutilizar exclusivamente o serviço atual de envio; não chamar o provedor WhatsApp diretamente.
- Em falhas transitórias, repetir com espera progressiva e limite definido; após esgotar, registrar a falha e notificar Owners/Admins.
- Eventos do sistema enfileiram ocorrências no momento da mudança. Agendamentos futuros usam uma fila persistente e processamento consolidado, sem criar um cron por cliente.
- Respeitar `America/Sao_Paulo` na interface e nos cálculos, armazenando os instantes em UTC.

## Dados, segurança e isolamento
- Criar entidades para regras, datas personalizadas, ocorrências e tentativas, com chaves estrangeiras e validação de coerência entre workspace, cliente, regra e destino.
- Garantir um único destino padrão ativo por cliente.
- Aplicar RLS tenant-aware e escopo de cliente em todas as leituras e escritas.
- Validar novamente no servidor a feature, a identidade, o papel Owner/Admin e o acesso ao cliente; a interface não será a fronteira de autorização.
- Workers terão operações estreitas para claim, conclusão e retry, sem ampliar privilégios dos usuários.
- Registrar auditoria para criação, edição, ativação, pausa, exclusão e troca do destino padrão.

## Feature e integrações
- Registrar `automations` no catálogo como não essencial e desativada por padrão.
- Usar o fluxo existente de habilitação pelo Super Admin, com confirmação e auditoria.
- Integrar os eventos aprovados nos pontos canônicos de tarefas, aprovações, publicações, portal e briefing, sem duplicar os fluxos atuais.
- Preservar limites, cooldown, mascaramento e logs do serviço WhatsApp já existente.

## Validação e entrega MASTER-first
- Cobrir regras de agenda, fuso, idempotência, retries, variáveis, autorização, RLS, isolamento entre clientes e disparo de cada família de evento.
- Testar destino por telefone e grupo, conexão ausente, variável inválida, concorrência, repetição do mesmo evento e falha definitiva com notificação.
- Validar a aba em desktop e mobile, inclusive estados vazio, carregando, bloqueado, erro e histórico.
- Incluir todas as novas estruturas, permissões e feature em `verify-installation.sql`, incluindo a checagem de completude exigida.
- Aplicar primeiro no MASTER, regenerar o delta, sincronizar versão e SHA, executar os guardiões e `master:check`.
- Publicar o MASTER e só propagar às instalações pelo fluxo Git-first, considerando concluída apenas após deployment `READY`.

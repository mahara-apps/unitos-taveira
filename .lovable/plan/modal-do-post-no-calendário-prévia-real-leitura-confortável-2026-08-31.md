# Modal do post no calendário: prévia real + leitura confortável

Hoje o modal do calendário é uma coluna estreita (640px) onde a legenda vive numa caixinha de ~130px de altura com scroll interno, então o texto nunca aparece inteiro; abaixo sobra muito espaço vazio (como no anexo). A tela do Composer/Agendamento já tem uma prévia estilo Instagram/Reels bem resolvida, mas ela está presa dentro do arquivo do wizard e não é reaproveitada.

## O que muda

Transformar o modal de detalhe numa **peça de leitura em duas colunas**, no espírito do modelo mLabs anexado:

```text
┌──────────────────────────────────────────────────────────────┐
│ Título da peça          [chip de status]  [chip de agenda] X  │
├──────────────────────┬───────────────────────────────────────┤
│  PRÉVIA              │  LEGENDA (texto inteiro, rolagem      │
│  (mock do canal:     │  só quando muito longa, "ver mais")   │
│   feed / reels /     │  + copiar legenda + contagem          │
│   stories, com       │─────────────────────────────────────── │
│   avatar, @perfil,   │  AGENDA  data · hora · America/SP     │
│   mídia e legenda)   │  estado da agenda (sugerida/reservada)│
│                      │─────────────────────────────────────── │
│  [ Instagram Feed ]  │  DESTINOS (por conta, status, link)   │
│  [ Reels ] [ Stories]│─────────────────────────────────────── │
│  troca de canal      │  HISTÓRICO (compacto, recolhível)     │
├──────────────────────┴───────────────────────────────────────┤
│                        [Cancelar agendamento]  [Editar]       │
└──────────────────────────────────────────────────────────────┘
```

Pontos de melhoria, um a um:

1. **Prévia do post** — a prévia do Composer passa a ser um componente compartilhado e é usada aqui, alimentada pela capa, canal/formato dos destinos, título/legenda e o perfil conectado. Se a peça tem vários destinos (ex.: Feed + Reels), aparecem abas para alternar a prévia, como no mLabs.
2. **Legenda legível** — ocupa a coluna larga, com tipografia de leitura, quebras preservadas, expandir/recolher em vez de uma janelinha rolante, botão "Copiar legenda" e contador de caracteres/hashtags.
3. **Agenda coerente** — data e hora sempre no fuso oficial (America/São Paulo, hoje o modal usa o fuso do navegador) e o estado da agenda em texto claro ("Agenda sugerida", "Aguardando o cliente", "Data reservada", "Sem data"), incluindo o comentário do cliente quando houver pedido de alteração.
4. **Destinos** — mantidos como estão (status por conta, link, "tentar novamente"), só reorganizados na coluna direita; quando não há destino, a mensagem passa a ser acionável ("Definir canal e conta") em vez de um aviso passivo.
5. **Espaço vazio** — modal mais largo e as seções passam a preencher a altura; nada de metade da tela em branco.
6. **Mobile** — as duas colunas empilham: prévia primeiro, depois legenda, agenda, destinos e histórico.

Nada de lógica nova: as ações continuam sendo as já existentes (cancelar agendamento, republicar destino com falha, editar/reagendar). Sem publicação automática, sem mexer em RBAC/RLS, banco ou nas funções de agenda.

## Detalhes técnicos

- Extrair `PostPreview` de `src/components/calendar/schedule-wizard/index.tsx` para `src/components/social/post-preview.tsx`, aceitando uma URL de mídia simples (a capa) além do asset da biblioteca, e importar nos dois lugares — fonte única de prévia.
- `src/components/calendar/board/publication-detail.tsx`: `size="lg"`, grade de duas colunas (`lg:grid-cols-[minmax(0,340px)_1fr]`), seções na coluna direita; abas de prévia derivadas de `item.destinations` (fallback para `item.channels`/`item.formats`).
- Datas via `src/lib/post-schedule-display.ts` (`scheduleDisplay`, `scheduleFullLabel`) e `APP_TIMEZONE`, substituindo `toLocaleString` local e o `Intl...resolvedOptions().timeZone` atual.
- Perfil/avatar da prévia: reutilizar `accountLabel` dos destinos; sem chamada nova ao servidor.
- Somente tokens semânticos de cor; chips continuam vindo de `publication-status-tokens`.
- Validação: `tsgo --noEmit`, testes selecionados e build.

# Social Core

**Único ponto autorizado** a se comunicar com APIs externas de redes sociais
no Unitos (Meta, LinkedIn, TikTok, YouTube, X, Threads…).

```
Workspace → Marca → Social Core → Provider → API Oficial
```

## Regras de arquitetura

1. Nenhum módulo (Integrações, Conteúdo, Calendário, Agendamentos,
   Publicações, Social Analytics, Brain, Automações, APIs internas) pode
   importar `MetaProvider`, o Graph API, `SocialAnalyticsService` ou
   qualquer server function específica de rede. Sempre via Social Core.
2. **Marca como fonte da verdade.** Toda operação recebe apenas
   `brandId + channel`. O usuário nunca escolhe `connectionId`.
3. **V1: 1 conta ativa por canal por Marca.** Reconexão pede substituição.
4. Toda rede social é um **Provider** implementando a mesma interface
   (`src/lib/social/provider.ts`).

## API pública

Server-side (`src/lib/social-core/core.server.ts`):

```ts
import { SocialCore } from "@/lib/social-core/core.server";

await SocialCore.publish(supabase, { brandId, channel: "instagram",
  placement: "feed", media: { imageUrl }, caption }, userToken);
```

Client-side (server functions em `api.functions.ts`):

| Função                        | Método | Descrição                          |
| ----------------------------- | ------ | ---------------------------------- |
| `socialCoreConnect`           | POST   | Inicia OAuth do canal              |
| `socialCoreDisconnect`        | POST   | Revoga conta ativa                 |
| `socialCoreRefreshToken`      | POST   | Renova token                       |
| `socialCorePublish`           | POST   | Publica agora                      |
| `socialCoreSchedule`          | POST   | Agenda publicação                  |
| `socialCoreGetDashboard`      | GET    | Dashboard consolidado              |
| `socialCoreGetPosts`          | GET    | Posts recentes                     |
| `socialCoreGetPost`           | GET    | Detalhe de post                    |
| `socialCoreGetTopPosts`       | GET    | Top posts por engajamento          |
| `socialCoreGetAudience`       | GET    | Audiência / seguidores             |
| `socialCoreGetProfile`        | GET    | Perfil canônico da conta           |
| `socialCoreListChannels`      | GET    | Canais ativos da Marca             |
| `socialCoreCapabilities`      | GET    | Capabilities disponíveis no canal  |

## Capabilities

`capabilities.ts` é a matriz oficial de "o que cada rede suporta na V1".
Consumidores devem checar antes de oferecer uma ação. Ampliar aqui ao
plugar um novo provider.

## Adicionando um novo Provider

1. Implemente `SocialProvider` em `src/lib/<rede>/provider.server.ts`.
2. Registre em `src/lib/social/registry.server.ts`.
3. Ative os capabilities correspondentes em
   `src/lib/social-core/capabilities.ts`.
4. **Nada muda no Social Core, no frontend, ou nas server functions.**
/**
 * Regras do vínculo em par da Meta (Página do Facebook + Instagram Business).
 *
 * O servidor grava os dois ativos em uma única ação; estas funções traduzem esse
 * resultado para a tela: quais canais ficam marcados como conectados e quais
 * contas entram na bandeja de conclusão (vínculo com o cliente).
 */

export type MetaChannel = "facebook" | "instagram" | "threads" | "ads";

export type LinkedAccount = {
  channel: MetaChannel;
  externalId: string;
  connectionId: string;
  label: string;
};

export type PairPage = {
  pageId: string;
  pageName: string;
  instagramBusinessId?: string | null;
  instagramUsername?: string | null;
};

export type SelectionEntry = {
  connectionId: string;
  label: string;
  channel: MetaChannel;
  /** Id usado pela linha da lista (Página, para o Instagram vindo de Página). */
  targetId: string;
  /** Id usado no mapa de conectados por canal. */
  lookupId: string;
};

/**
 * Converte o retorno do vínculo em entradas de seleção. Para o Instagram vindo
 * de uma Página, `targetId` é o id da Página — é assim que a lista identifica a
 * linha.
 */
export function selectionEntriesFromLinked(
  linked: LinkedAccount[],
  pages: PairPage[],
): SelectionEntry[] {
  return linked.map((item) => {
    if (item.channel === "instagram") {
      const page = pages.find((p) => p.instagramBusinessId === item.externalId);
      return {
        connectionId: item.connectionId,
        label: item.label,
        channel: item.channel,
        targetId: page?.pageId ?? item.externalId,
        lookupId: item.externalId,
      };
    }
    return {
      connectionId: item.connectionId,
      label: item.label,
      channel: item.channel,
      targetId: item.externalId,
      lookupId: item.externalId,
    };
  });
}

/** Instagram Business que será ativado junto com a Página, quando existir. */
export function pairedInstagramOf(page: PairPage): { id: string; username: string | null } | null {
  if (!page.instagramBusinessId) return null;
  return { id: page.instagramBusinessId, username: page.instagramUsername ?? null };
}

/**
 * Conexões a remover ao desativar uma linha. Desativar a Página remove também o
 * Instagram que veio no mesmo par; desativar o Instagram não mexe na Página.
 */
export function unlinkTargets(args: {
  channel: MetaChannel;
  page: PairPage | null;
  connected: { facebook: Record<string, string>; instagram: Record<string, string> };
}): Array<{ channel: MetaChannel; lookupId: string; connectionId: string }> {
  const out: Array<{ channel: MetaChannel; lookupId: string; connectionId: string }> = [];
  const push = (channel: "facebook" | "instagram", lookupId: string | null | undefined) => {
    if (!lookupId) return;
    const connectionId = args.connected[channel][lookupId];
    if (connectionId) out.push({ channel, lookupId, connectionId });
  };
  if (args.channel === "facebook" && args.page) {
    push("facebook", args.page.pageId);
    push("instagram", args.page.instagramBusinessId);
  }
  return out;
}

/** Texto do aviso de par exibido na linha da Página. */
export function pairHint(page: PairPage): string {
  const ig = pairedInstagramOf(page);
  if (!ig) return "Sem Instagram Business vinculado a esta Página na Meta.";
  return `Ativa junto o Instagram ${ig.username ? `@${ig.username}` : ig.id}.`;
}

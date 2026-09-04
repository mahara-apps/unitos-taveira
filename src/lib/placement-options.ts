/**
 * Opções avançadas POR DESTINO (canal + formato).
 *
 * Isomórfico — usado pela UI do composer e pela camada de publicação.
 * Fonte única da verdade sobre "qual opção aparece em qual destino" e sobre
 * "o que é realmente aplicado na API" versus "o que é apenas anotação
 * operacional da equipe".
 *
 * Persistência: `post_placements.copy_override.options` (jsonb já existente).
 * Nenhuma opção é obrigatória — vazio = comportamento atual, sem mudanças.
 */

import type { PlacementFormat } from "@/lib/scheduling-formats";
import type { SocialChannel } from "@/lib/social-core/capabilities";

export type PlacementOptionKey =
  // Aplicadas de fato na API da Meta
  | "firstComment"
  | "location"
  | "userTags"
  | "collaborators"
  | "shareToFeed"
  | "disableComments"
  | "audioName"
  // Anotação operacional (sem efeito na API)
  | "paidPartnership"
  | "shopTagging"
  | "altText"
  | "storyMention";

export type PlacementOptionKind = "text" | "boolean" | "list";

export type PlacementOptionDef = {
  key: PlacementOptionKey;
  label: string;
  hint: string;
  kind: PlacementOptionKind;
  /** true = aplicado na publicação; false = apenas anotação para a equipe. */
  apiApplied: boolean;
  placeholder?: string;
  maxLength?: number;
};

export const PLACEMENT_OPTION_DEFS: Readonly<Record<PlacementOptionKey, PlacementOptionDef>> =
  Object.freeze({
    firstComment: {
      key: "firstComment",
      label: "Primeiro comentário",
      hint: "Publicado automaticamente logo após a peça ir ao ar.",
      kind: "text",
      apiApplied: true,
      placeholder: "Ex.: #hashtags extras ou link do link na bio",
      maxLength: 2200,
    },
    location: {
      key: "location",
      label: "Localização",
      hint: "Marca o local na publicação do Instagram.",
      kind: "text",
      apiApplied: true,
      placeholder: "Ex.: São Paulo, Brasil",
      maxLength: 120,
    },
    userTags: {
      key: "userTags",
      label: "Marcação de pessoas",
      hint: "Perfis marcados na mídia (um @usuário por item).",
      kind: "list",
      apiApplied: true,
      placeholder: "@usuario",
    },
    collaborators: {
      key: "collaborators",
      label: "Colaborador",
      hint: "Convite de coautoria (o perfil precisa aceitar no Instagram).",
      kind: "list",
      apiApplied: true,
      placeholder: "@usuario",
    },
    shareToFeed: {
      key: "shareToFeed",
      label: "Compartilhar no Feed",
      hint: "Exibe o Reels também na grade do perfil.",
      kind: "boolean",
      apiApplied: true,
    },
    disableComments: {
      key: "disableComments",
      label: "Desativar comentários",
      hint: "Fecha os comentários assim que a peça é publicada.",
      kind: "boolean",
      apiApplied: true,
    },
    audioName: {
      key: "audioName",
      label: "Configuração de áudio",
      hint: "Nome do áudio original exibido no Reels.",
      kind: "text",
      apiApplied: true,
      placeholder: "Ex.: Áudio original da marca",
      maxLength: 120,
    },
    paidPartnership: {
      key: "paidPartnership",
      label: "Parceria paga",
      hint: "Registro interno: não é aplicado automaticamente na publicação.",
      kind: "text",
      apiApplied: false,
      placeholder: "@parceiro",
      maxLength: 120,
    },
    shopTagging: {
      key: "shopTagging",
      label: "Instagram Shop / produto",
      hint: "Registro interno: não é aplicado automaticamente na publicação.",
      kind: "text",
      apiApplied: false,
      placeholder: "Produto ou SKU",
      maxLength: 200,
    },
    altText: {
      key: "altText",
      label: "Texto alternativo",
      hint: "Registro interno: não é aplicado automaticamente na publicação.",
      kind: "text",
      apiApplied: false,
      placeholder: "Descreva a imagem",
      maxLength: 500,
    },
    storyMention: {
      key: "storyMention",
      label: "Adicionar menção",
      hint: "Registro interno: não é aplicado automaticamente na publicação.",
      kind: "text",
      apiApplied: false,
      placeholder: "@usuario",
      maxLength: 120,
    },
  });

/**
 * Matriz de opções por canal + formato. Somente estes destinos têm painel de
 * opções hoje; qualquer outro devolve lista vazia (nada aparece na UI).
 */
export function optionsForDestination(
  channel: SocialChannel,
  format: PlacementFormat,
): PlacementOptionKey[] {
  if (channel === "instagram") {
    if (format === "feed" || format === "carrossel") {
      return [
        "firstComment",
        "location",
        "userTags",
        "collaborators",
        "disableComments",
        "paidPartnership",
        "shopTagging",
        "altText",
      ];
    }
    if (format === "reels") {
      return [
        "audioName",
        "firstComment",
        "collaborators",
        "shareToFeed",
        "location",
        "disableComments",
        "paidPartnership",
        "shopTagging",
      ];
    }
    if (format === "stories") {
      return ["storyMention", "paidPartnership", "altText"];
    }
    return [];
  }
  if (channel === "facebook") {
    if (format === "feed" || format === "carrossel") return ["firstComment", "altText"];
    return [];
  }
  return [];
}

export type PlacementOptions = {
  firstComment?: string;
  location?: string;
  userTags?: string[];
  collaborators?: string[];
  shareToFeed?: boolean;
  disableComments?: boolean;
  audioName?: string;
  paidPartnership?: string;
  shopTagging?: string;
  altText?: string;
  storyMention?: string;
};

const LIST_KEYS = new Set<PlacementOptionKey>(["userTags", "collaborators"]);
const BOOL_KEYS = new Set<PlacementOptionKey>(["shareToFeed", "disableComments"]);

/** Remove o @ inicial e espaços — a Meta espera apenas o username. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

/**
 * Normaliza o objeto de opções: descarta chaves que não pertencem ao destino,
 * remove valores vazios e aplica limites de tamanho. Entrada não confiável.
 */
export function normalizePlacementOptions(
  channel: SocialChannel,
  format: PlacementFormat,
  raw: unknown,
): PlacementOptions {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const allowed = new Set(optionsForDestination(channel, format));
  const out: Record<string, unknown> = {};

  for (const key of allowed) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const def = PLACEMENT_OPTION_DEFS[key];

    if (BOOL_KEYS.has(key)) {
      if (typeof value === "boolean") out[key] = value;
      continue;
    }
    if (LIST_KEYS.has(key)) {
      const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
      const clean = Array.from(
        new Set(
          list
            .filter((v): v is string => typeof v === "string")
            .map(normalizeHandle)
            .filter(Boolean),
        ),
      ).slice(0, 20);
      if (clean.length) out[key] = clean;
      continue;
    }
    if (typeof value !== "string") continue;
    const text = value.trim().slice(0, def.maxLength ?? 500);
    if (text) out[key] = text;
  }

  return out as PlacementOptions;
}

/** true quando o destino tem pelo menos uma opção preenchida. */
export function hasPlacementOptions(options: PlacementOptions | null | undefined): boolean {
  if (!options) return false;
  return Object.values(options).some((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : Boolean(v),
  );
}

/** Contagem para o badge do chip de destino. */
export function countPlacementOptions(options: PlacementOptions | null | undefined): number {
  if (!options) return 0;
  return Object.values(options).filter((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : Boolean(v),
  ).length;
}

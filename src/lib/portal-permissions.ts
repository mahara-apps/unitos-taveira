/**
 * Permissões do Portal do Cliente — definidas POR CLIENTE (valem para todos os
 * contatos daquele cliente) e guardadas em `public.client_portal_access`.
 *
 * Este módulo é puro: catálogo, normalização e leitura de nível. Enforcement
 * fica no servidor (`portal-permissions.server.ts`); a UI usa as mesmas funções
 * apenas para esconder o que já está bloqueado no backend.
 */

export type PortalModuleId =
  | "approvals"
  | "pauta"
  | "calendar"
  | "briefing"
  | "files"
  | "brand"
  | "requests"
  | "messages";

/** Nenhum = nem aparece. Ver = acompanha. Interagir = decide/responde. */
export type PortalPermissionLevel = "none" | "view" | "interact";

export const PORTAL_PERMISSION_LEVELS: readonly PortalPermissionLevel[] = [
  "none",
  "view",
  "interact",
];

export const PORTAL_PERMISSION_LABEL: Record<PortalPermissionLevel, string> = {
  none: "Sem acesso",
  view: "Somente ver",
  interact: "Ver e interagir",
};

export const PORTAL_MODULES: Array<{
  id: PortalModuleId;
  label: string;
  description: string;
  /** O que "interagir" libera para o cliente neste módulo. */
  interact: string;
  /** Módulos sem interação possível ficam apenas em Nenhum/Ver. */
  viewOnly?: boolean;
}> = [
  {
    id: "approvals",
    label: "Aprovações",
    description: "Conteúdos enviados para revisão do cliente.",
    interact: "Aprovar, pedir ajuste e comentar",
  },
  {
    id: "pauta",
    label: "Pauta",
    description: "Planejamento de conteúdo do mês.",
    interact: "Aprovar a pauta e itens individuais",
  },
  {
    id: "calendar",
    label: "Calendário",
    description: "Publicações e datas propostas.",
    interact: "Confirmar datas e pedir alteração",
  },
  {
    id: "briefing",
    label: "Briefing",
    description: "Solicitações de informação da equipe.",
    interact: "Responder e enviar anexos",
  },
  {
    id: "files",
    label: "Arquivos",
    description: "Documentos liberados para a marca.",
    interact: "",
    viewOnly: true,
  },
  {
    id: "brand",
    label: "Minha Marca",
    description: "Informações de marca consolidadas.",
    interact: "",
    viewOnly: true,
  },
  {
    id: "messages",
    label: "Mensagens",
    description: "Conversas compartilhadas com a equipe.",
    interact: "Enviar mensagens e links na conversa",
  },
  {
    id: "requests",
    label: "Pedidos",
    description: "Solicitações que o cliente envia para a equipe.",
    interact: "Abrir novos pedidos e comentar",
  },
];

export type PortalPermissions = Record<PortalModuleId, PortalPermissionLevel>;

/** Padrão de um cliente novo: decide conteúdo e pauta, acompanha o resto. */
export const DEFAULT_PORTAL_PERMISSIONS: PortalPermissions = {
  approvals: "interact",
  pauta: "interact",
  calendar: "view",
  briefing: "interact",
  files: "view",
  brand: "view",
  requests: "interact",
  messages: "interact",
};

const isLevel = (v: unknown): v is PortalPermissionLevel =>
  typeof v === "string" && (PORTAL_PERMISSION_LEVELS as readonly string[]).includes(v);

/** Nunca confia no que chega do cliente/banco: campo inválido volta ao padrão. */
export function normalizePortalPermissions(input: unknown): PortalPermissions {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PORTAL_PERMISSIONS };
  for (const mod of PORTAL_MODULES) {
    const value = raw[mod.id];
    if (!isLevel(value)) continue;
    out[mod.id] = mod.viewOnly && value === "interact" ? "view" : value;
  }
  return out;
}

export const portalCanView = (perms: PortalPermissions, id: PortalModuleId): boolean =>
  perms[id] !== "none";

export const portalCanInteract = (perms: PortalPermissions, id: PortalModuleId): boolean =>
  perms[id] === "interact";

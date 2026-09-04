// Client-safe: tipos de destinatário de WhatsApp compartilhados entre UI e server.

export const WHATSAPP_RECIPIENT_TYPES = [
  "client_contact",
  "account_manager",
  "workspace_admin",
  "workspace_user",
  "whatsapp_group",
] as const;

export type WhatsappRecipientType = (typeof WHATSAPP_RECIPIENT_TYPES)[number];

export const WHATSAPP_RECIPIENT_LABELS: Record<WhatsappRecipientType, string> = {
  client_contact: "Contato do cliente",
  account_manager: "Gestor da conta",
  workspace_admin: "ADMIN do workspace",
  workspace_user: "Usuário do workspace",
  whatsapp_group: "Grupo de WhatsApp",
};

/** Tipos cujo destino é dinâmico: vem do cadastro do usuário, sem duplicar dados. */
export const DYNAMIC_RECIPIENT_TYPES: readonly WhatsappRecipientType[] = [
  "account_manager",
  "workspace_admin",
  "workspace_user",
];

export type WhatsappRecipientRow = {
  id: string;
  brandId: string;
  clientId: string | null;
  clientName: string | null;
  userId: string | null;
  userName: string | null;
  type: WhatsappRecipientType;
  name: string;
  roleLabel: string | null;
  destination: string | null;
  isActive: boolean;
  createdAt: string;
};

import type { normalizePortalTheme, resolvePortalTheme } from "@/lib/portal-theme";

export type PortalJson =
  | string
  | number
  | boolean
  | null
  | PortalJson[]
  | { [key: string]: PortalJson };

export type PortalClient = {
  id: string;
  name: string;
  niche: string | null;
  color: string | null;
  socials: PortalJson | null;
  contact_name: string | null;
  contact_email: string | null;
  logo_url: string | null;
  portal_theme?: PortalJson;
};

export type PortalBrand = { id: string; name: string };

export type PortalSlaStatus = "none" | "on_track" | "at_risk" | "overdue";

export type PortalSla = {
  status: PortalSlaStatus;
  slaHours: number | null;
  hoursInStage: number;
  hoursRemaining: number;
  hoursOverdue: number;
  dueAt: string | null;
};

export type PortalPost = {
  id: string;
  title: string | null;
  copy?: string | null;
  format: string | null;
  channels: string[] | null;
  scheduled_at: string | null;
  published_at?: string | null;
  stage: string | null;
  cover_url: string | null;
  reference_media: PortalJson;
  script?: string | null;
  approval?: { status: string; notes: string | null; decided_at: string | null };
  sla?: PortalSla;
};

export type PortalApproval = {
  status: string;
  notes: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
};

export type PortalResolveResult = {
  clientId: string | null;
  brandId: string | null;
  client: PortalClient | null;
  brand: PortalBrand | null;
  theme: ReturnType<typeof resolvePortalTheme> | null;
  error?: string;
};

export type PortalMetrics = {
  pending: number;
  approvedThisMonth: number;
  scheduled: number;
  total: number;
  sla: { tracked: number; onTrack: number; atRisk: number; overdue: number };
};

export type PortalFile = {
  id: string;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type PortalBriefing = {
  id: string;
  token: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  submitted_at: string | null;
  created_at: string;
};

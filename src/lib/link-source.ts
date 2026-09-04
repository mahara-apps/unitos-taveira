/**
 * Detecção da origem de um link colado (Drive, Figma, etc.) e validação de URL.
 * Client-safe: usado tanto na UI quanto nas server functions.
 */

export type LinkSource =
  | "drive"
  | "docs"
  | "figma"
  | "dropbox"
  | "onedrive"
  | "notion"
  | "youtube"
  | "vimeo"
  | "wetransfer"
  | "canva"
  | "link";

const HOST_MAP: Array<{ match: RegExp; source: LinkSource }> = [
  { match: /(^|\.)drive\.google\.com$/i, source: "drive" },
  { match: /(^|\.)docs\.google\.com$/i, source: "docs" },
  { match: /(^|\.)figma\.com$/i, source: "figma" },
  { match: /(^|\.)dropbox\.com$/i, source: "dropbox" },
  { match: /(^|\.)(onedrive\.live\.com|sharepoint\.com|1drv\.ms)$/i, source: "onedrive" },
  { match: /(^|\.)notion\.(so|site)$/i, source: "notion" },
  { match: /(^|\.)(youtube\.com|youtu\.be)$/i, source: "youtube" },
  { match: /(^|\.)vimeo\.com$/i, source: "vimeo" },
  { match: /(^|\.)wetransfer\.com$/i, source: "wetransfer" },
  { match: /(^|\.)canva\.com$/i, source: "canva" },
];

export const LINK_SOURCE_LABEL: Record<LinkSource, string> = {
  drive: "Google Drive",
  docs: "Google Docs",
  figma: "Figma",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  notion: "Notion",
  youtube: "YouTube",
  vimeo: "Vimeo",
  wetransfer: "WeTransfer",
  canva: "Canva",
  link: "Link",
};

/** Normaliza a URL digitada; retorna `null` quando não é http(s) válida. */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed.length > 2000) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  const href = url.toString();
  return href.length <= 2000 ? href : null;
}

export function detectLinkSource(url: string): LinkSource {
  try {
    const host = new URL(url).hostname;
    for (const entry of HOST_MAP) if (entry.match.test(host)) return entry.source;
  } catch {
    /* url inválida cai no genérico */
  }
  return "link";
}

/** Rótulo curto para exibir quando o usuário não informou um título. */
export function linkFallbackLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return path && path !== "/" ? `${u.hostname}${path.slice(0, 40)}` : u.hostname;
  } catch {
    return url;
  }
}

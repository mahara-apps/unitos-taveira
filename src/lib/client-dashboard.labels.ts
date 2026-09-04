const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  blog: "Blog",
};

export function channelLabel(raw: string): string {
  return CHANNEL_LABEL[raw.toLowerCase()] ?? raw;
}

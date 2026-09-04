// Pure classifier used by the realtime Brain stream to bucket incoming
// events. Kept close to its only consumer (`use-brain-stream`).
export type BrainCategoryKey = "content" | "media" | "messaging" | "insight";

export function classifyBrainEvent(sourceModule: string, eventType: string): BrainCategoryKey {
  if (eventType.startsWith("insight")) return "insight";
  const s = sourceModule.toLowerCase();
  if (s.includes("media") || s.includes("ads")) return "media";
  if (s.includes("messag") || s.includes("mail") || s.includes("whats")) return "messaging";
  return "content";
}

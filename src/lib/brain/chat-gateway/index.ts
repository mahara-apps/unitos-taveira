export { consolidate, tryDirectAnswer } from "./consolidate";
export type { BrainConsolidated } from "./consolidate";
export type { ChatAttachmentMeta } from "./llm.server";
export type { ChatAttachmentInput } from "./multimodal.server";
export type { ToolCallLog } from "./tools.server";
// llm.server.ts é importado dinamicamente na Brain API para manter o boundary server-only.

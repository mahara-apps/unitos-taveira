import { generateText } from "ai";
import { getBrandAiModelAdmin, generateBrandImage, embedTextAdmin } from "/dev-server/src/lib/ai-provider.server";
const BRAND = "60fce5a7-1859-4bbd-a887-9018ed7f17b5";
const out: any = {};
try {
  const m = await getBrandAiModelAdmin(BRAND, "text", "operational", { agent: "audit.text" });
  out.text = { provider: m.provider, model: m.modelId, fallback: m.fallbackProvider };
  const r = await generateText({ model: m.model, prompt: "Responda em pt-BR: diga apenas OK-AUDIT." });
  out.text.output = r.text.trim().slice(0,120);
  out.text.usage = r.usage;
} catch (e: any) { out.text = { error: String(e?.message ?? e).slice(0,400) }; }
try {
  const m = await getBrandAiModelAdmin(BRAND, "text", "strategic", { agent: "audit.strategic" });
  out.strategic = { provider: m.provider, model: m.modelId };
} catch (e: any) { out.strategic = { error: String(e?.message ?? e).slice(0,300) }; }
try {
  const { supabaseAdmin } = await import("/dev-server/src/integrations/supabase/client.server");
  const img = await generateBrandImage(supabaseAdmin, BRAND, "Um prato de comida brasileira, foto publicitária");
  out.image = { provider: img.provider, contentType: img.contentType, bytes: Math.round(img.base64.length*0.75) };
} catch (e: any) { out.image = { error: String(e?.message ?? e).slice(0,400) }; }
try {
  const emb = await embedTextAdmin(BRAND, "teste de embedding auditoria");
  out.embedding = emb ? { dims: emb.length } : { error: "null (degradou)" };
} catch (e: any) { out.embedding = { error: String(e?.message ?? e).slice(0,300) }; }
console.log(JSON.stringify(out, null, 2));

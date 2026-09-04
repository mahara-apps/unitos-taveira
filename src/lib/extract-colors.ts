// Simple client-side dominant color extractor using canvas + quantization.
// Buckets pixels into a 4-bit-per-channel color cube (4096 bins), skips
// near-white / near-black / near-transparent pixels, returns top N as hex.

export type ExtractedColor = { hex: string; count: number };

function toHex(n: number) {
  return n.toString(16).padStart(2, "0");
}

export async function extractDominantColors(src: string, max = 6): Promise<ExtractedColor[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 128;
        const scale = Math.min(1, size / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);

        const bins = new Map<number, { r: number; g: number; b: number; c: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 200) continue;
          const r = data[i],
            g = data[i + 1],
            b = data[i + 2];
          // skip near-white and near-black
          if (r > 240 && g > 240 && b > 240) continue;
          if (r < 15 && g < 15 && b < 15) continue;
          // ignore near-greys (low saturation)
          const mx = Math.max(r, g, b),
            mn = Math.min(r, g, b);
          if (mx - mn < 12) continue;
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const cur = bins.get(key);
          if (cur) {
            cur.r += r;
            cur.g += g;
            cur.b += b;
            cur.c += 1;
          } else {
            bins.set(key, { r, g, b, c: 1 });
          }
        }

        const ranked = Array.from(bins.values())
          .map((v) => ({
            r: Math.round(v.r / v.c),
            g: Math.round(v.g / v.c),
            b: Math.round(v.b / v.c),
            count: v.c,
          }))
          .sort((a, b) => b.count - a.count);

        // Merge visually similar colors (delta < 40 in RGB space)
        const merged: typeof ranked = [];
        for (const c of ranked) {
          const near = merged.find(
            (m) => Math.abs(m.r - c.r) + Math.abs(m.g - c.g) + Math.abs(m.b - c.b) < 40,
          );
          if (near) near.count += c.count;
          else merged.push({ ...c });
          if (merged.length >= max * 3) break;
        }

        resolve(
          merged
            .slice(0, max)
            .map((c) => ({ hex: `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`, count: c.count })),
        );
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => resolve([]);
    img.src = src;
  });
}

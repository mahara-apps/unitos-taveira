// Access the h3 event stored by TanStack Start's AsyncLocalStorage so we can
// extend the Cloudflare Worker isolate lifetime past the HTTP response for
// background AI jobs. Falls back to a no-op keep-alive in Node/dev.
const EVENT_KEY = Symbol.for("tanstack-start:event-storage");

export function waitUntil(promise: Promise<unknown>): void {
  const safe = Promise.resolve(promise).catch((err) => {
    console.error("[waitUntil] background job failed:", err);
  });
  try {
    const store = (
      globalThis as unknown as Record<
        symbol,
        { getStore?: () => { h3Event?: { waitUntil?: (p: Promise<unknown>) => void } } }
      >
    )[EVENT_KEY];
    const h3Event = store?.getStore?.()?.h3Event;
    if (h3Event?.waitUntil) {
      h3Event.waitUntil(safe);
      return;
    }
  } catch {
    // fall through
  }
  // Dev / Node fallback — the Node event loop stays alive until the promise
  // settles, so a plain reference is enough.
  void safe;
}

// Shared retry wrapper. Three failure modes hit in a row on 2026-07-14, all on the same
// 12-page sourcing.companies read:
//   1. ECONNRESET before any Exa/LLM call fired (no spend lost, just had to re-run).
//   2. A plain fetch() that hung forever with no error at all — Node's fetch has no default
//      timeout, so a stalled connection just waits indefinitely.
//   3. A timeout that only covered fetch()'s promise (which resolves as soon as HEADERS
//      arrive) — status 200 came back in 4s, then `await res.json()` in the CALLER hung for
//      60s+ with zero protection, because the abort timer had already been cleared the moment
//      fetch() resolved, before the body was ever read.
//
// Fix: fetchRetry reads the body itself, inside the same timeout window, and hands back a
// Response-shaped object ({ok, status, json(), text()}) so every existing call site
// (`res.ok`, `await res.json()`, `await res.text()`) keeps working unchanged.

const TIMEOUT_MS = 20_000;

export async function fetchRetry(url, options = {}, { retries = 3, baseDelayMs = 500, timeoutMs = TIMEOUT_MS } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: abort.signal });
      const bodyText = await res.text(); // still inside the timeout window
      clearTimeout(timer);
      return {
        ok: res.ok,
        status: res.status,
        text: async () => bodyText,
        json: async () => (bodyText ? JSON.parse(bodyText) : null),
      };
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error(`[fetchRetry] timed out after ${timeoutMs}ms: ${url}`) : e;
      if (attempt === retries) break;
      // Visible per F1 — silent retries hide how often the network path stalls.
      console.log(`[fetchRetry] retry ${attempt + 1}/${retries} after ${e.name === 'AbortError' ? `abort (${timeoutMs}ms)` : e.code || e.name}: ${url.slice(0, 120)}`);
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

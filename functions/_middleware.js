// AiVenture — middleware Cloudflare Pages

// ---- AiVenture: subsolul comun al rețelei (v1.0, 2026-11-01, sesiunea 0008C) ----
// Adaugă înainte de </body> subsolul comun: linkurile legale + rândul EU AI Act (insigna și cele 10 module).
// Sursa unică: Worker-ul aiventure-legal, citit prin aiventure.ro/legal/strip.html?host=<domeniu>, păstrat 5 minute.
// Fail-open: orice eroare lasă pagina neatinsă. Nu se adaugă de două ori (verifică #aiventure-legal-strip).
const AIV_STRIP_SRC = "https://aiventure.ro/legal/strip.html?host=";
const AIV_STRIP_TTL = 5 * 60 * 1000;
let aivStripCache = { at: 0, host: "", html: null };

async function aivLoadStrip(host) {
  const now = Date.now();
  if (aivStripCache.html && aivStripCache.host === host && now - aivStripCache.at < AIV_STRIP_TTL) return aivStripCache.html;
  try {
    const res = await fetch(AIV_STRIP_SRC + encodeURIComponent(host), { cf: { cacheTtl: 300 } });
    if (!res.ok) return aivStripCache.html;
    const html = await res.text();
    if (!html.includes('id="aiventure-legal-strip"')) return aivStripCache.html;
    aivStripCache = { at: now, host, html };
    return html;
  } catch (e) {
    return aivStripCache.html;
  }
}

async function aiventureStrip(context) {
  const response = await context.next();
  try {
    const request = context.request;
    if (request.method !== "GET" || !response.ok) return response;
    if (!(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) return response;
    const host = new URL(request.url).hostname.toLowerCase().replace(/^www\./, "");
    const strip = await aivLoadStrip(host);
    if (!strip) return response;
    let present = false;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("etag");
    return new HTMLRewriter()
      .on("#aiventure-legal-strip", { element() { present = true; } })
      .on("body", { element(el) { el.onEndTag((end) => { if (!present) end.before(strip, { html: true }); }); } })
      .transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
  } catch (e) {
    return response;
  }
}

export const onRequest = [aiventureStrip];

// /api/session
// GET  -> { current: "0002H" }   the working session pointer, read from KV if set, else DEFAULT_SESSION
// POST -> { session, url, global, scores } records one observation for that session+url pair.
//         Used by index.html right after a 167-signal audit finishes, so later
//         GET /api/session/compare?a=...&b=...&url=... has something real to diff.
//
// Storage: Cloudflare KV, binding name AI_LENS_SESSIONS (see wrangler.toml).
// If the binding is not configured, GET still returns the default session (never fails
// the page load), and POST returns 501 rather than pretending to have saved anything.

const DEFAULT_SESSION = '0002H';

function normSession(raw) {
  const m = String(raw || '').trim().toUpperCase().match(/^(\d{4})\s*([CHT]?)$/);
  if (!m) return null;
  return m[1] + (m[2] || 'C');
}

async function hashUrl(u) {
  const data = new TextEncoder().encode(String(u || '').trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function onRequestGet(context) {
  const kv = context.env.AI_LENS_SESSIONS;
  let current = DEFAULT_SESSION;
  if (kv) {
    try {
      const stored = await kv.get('meta:current');
      if (stored) current = stored;
    } catch { /* fall through to default */ }
  }
  return Response.json({ current, storage_configured: Boolean(kv) });
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); }
  catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const session = normSession(body.session) || DEFAULT_SESSION;
  const targetUrl = String(body.url || '').trim();
  if (!targetUrl) {
    return Response.json({ ok: false, error: 'url is required' }, { status: 400 });
  }

  const kv = context.env.AI_LENS_SESSIONS;
  if (!kv) {
    return Response.json(
      { ok: false, error: 'AI_LENS_SESSIONS KV binding is not configured on this deployment.' },
      { status: 501 }
    );
  }

  const key = `obs:${session}:${await hashUrl(targetUrl)}`;
  const record = {
    session,
    url: targetUrl,
    ts: new Date().toISOString(),
    global: (typeof body.global === 'number' && !Number.isNaN(body.global)) ? body.global : null,
    scores: (body.scores && typeof body.scores === 'object') ? body.scores : {}
  };

  await kv.put(key, JSON.stringify(record));
  return Response.json({ ok: true, session, url: targetUrl });
}

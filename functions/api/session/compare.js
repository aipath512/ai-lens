// /api/session/compare?a=0001H&b=0002H&url=https://example.com
// Reads observations recorded by POST /api/session and returns a delta.
// Never fabricates a comparison: if either side has no recorded observation
// for that exact URL, delta is omitted and `note` explains why — the
// frontend (compareSessions() in index.html) already handles that shape.

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
  const url = new URL(context.request.url);
  const a = normSession(url.searchParams.get('a')) || DEFAULT_SESSION;
  const b = normSession(url.searchParams.get('b')) || DEFAULT_SESSION;
  const targetUrl = (url.searchParams.get('url') || '').trim();

  if (!normSession(url.searchParams.get('a')) || !normSession(url.searchParams.get('b'))) {
    return Response.json({
      error: 'A session looks like four digits followed by C, H or T. A trailing space means the same as C.'
    });
  }

  const kv = context.env.AI_LENS_SESSIONS;
  if (!kv) {
    return Response.json({
      a: { session: a, observations: 0 },
      b: { session: b, observations: 0 },
      note: 'Session storage is not configured on this deployment (AI_LENS_SESSIONS KV binding missing).'
    });
  }

  const [listA, listB] = await Promise.all([
    kv.list({ prefix: `obs:${a}:` }),
    kv.list({ prefix: `obs:${b}:` })
  ]);

  const result = {
    a: { session: a, observations: listA.keys.length },
    b: { session: b, observations: listB.keys.length }
  };

  if (!targetUrl) {
    result.note = 'Add a URL to compare a specific site between these two sessions.';
    return Response.json(result);
  }

  const hash = await hashUrl(targetUrl);
  const [obsA, obsB] = await Promise.all([
    kv.get(`obs:${a}:${hash}`, 'json'),
    kv.get(`obs:${b}:${hash}`, 'json')
  ]);

  if (!obsA || !obsB) {
    result.note = (!obsA && !obsB)
      ? `No observation recorded for ${targetUrl} under either session yet.`
      : `No observation recorded for ${targetUrl} under session ${!obsA ? a : b} yet.`;
    return Response.json(result);
  }

  const scores = {};
  const dims = new Set([...Object.keys(obsA.scores || {}), ...Object.keys(obsB.scores || {})]);
  for (const dim of dims) {
    const av = obsA.scores?.[dim];
    const bv = obsB.scores?.[dim];
    if (typeof av === 'number' && typeof bv === 'number') scores[dim] = bv - av;
  }

  result.delta = {
    url: targetUrl,
    global: (typeof obsA.global === 'number' && typeof obsB.global === 'number') ? (obsB.global - obsA.global) : 0,
    scores
  };
  return Response.json(result);
}

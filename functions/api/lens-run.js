// /api/lens-run
// For a target URL: discover the homepage + up to N sitemap pages, in sitemap order.
// For each of the 4 AI providers (ChatGPT, Claude, Gemini, Perplexity), IN SEQUENCE —
// one provider fully finishes its entire page-by-page walk, gets memorized, THEN the
// next provider starts — walk that same page list in order, one page at a time,
// handing the provider everything read so far and asking it to reconstruct a fixed
// set of business fields. Every step reports the COMPLETE current state of all fields
// (not just what changed), so the page-by-page trace is a full record of what that AI
// knows at that point, not a diff summary.
// Finishes with one direct synthesis: a cross-AI table + a short ranked list of
// concrete measures, not abstract scoring.
//
// This does NOT use live web search — it walks the SAME fetched material for every
// provider, on purpose, so differences between providers reflect reconstruction,
// not different search results. (Natural open-web discovery is a separate concern,
// not part of this endpoint.)

const enc = new TextEncoder();

const FIELDS = ['WHO','OFFER','AUDIENCE','PROBLEM','VALUE','WHY_YOU','EVIDENCE','COMPETITION','HOW_TO_BUY'];
const PROVIDERS = ['ChatGPT','Claude','Gemini','Perplexity'];
const DEFAULT_MAX_PAGES = 10;
const HARD_MAX_PAGES = 20;
const PROVIDER_TIMEOUT_MS = 30000;
const MAX_CORPUS_CHARS = 45000; // per-provider accumulated text cap, to keep prompts bounded

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const target = normalizeUrl(body.target_url || '');
  if (!target) return Response.json({ error: 'Valid target_url required' }, { status: 400 });
  const maxPages = clamp(parseInt(body.max_pages, 10) || DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        send({ type: 'session', target_url: target, max_pages: maxPages });

        send({ type: 'discovering' });
        const pages = await discoverPages(target, maxPages);
        if (!pages.length) {
          send({ type: 'job_end', return_code: '0008', error: 'Could not fetch the target URL at all.' });
          controller.close();
          return;
        }
        send({ type: 'pages', pages: pages.map(p => ({ url: p.url, status: p.status })) });

        // Sequential by design: AI #1 walks every page first and its full trace is
        // memorized, THEN AI #2 starts from page 1, and so on — not 4 parallel streams.
        const providerResults = {};
        for (const name of PROVIDERS) {
          send({ type: 'provider_start', provider: name });
          providerResults[name] = await walkProvider(context.env, name, target, pages, (evt) => send(evt));
          send({ type: 'provider_done', provider: name, final_fields: providerResults[name].final_fields, never_found: providerResults[name].never_found });
        }

        send({ type: 'synthesizing' });
        const synthesis = await synthesize(context.env, target, providerResults);
        send({ type: 'synthesis', ...synthesis });

        send({ type: 'job_end', return_code: '0000' });
      } catch (e) {
        send({ type: 'job_end', return_code: '9999', error: String(e?.message || e) });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function normalizeUrl(v) {
  try {
    v = String(v || '').trim();
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
  } catch { return null; }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linksFrom(html, base) {
  const out = [];
  const re = /href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === new URL(base).origin && !out.includes(u.href)) out.push(u.href);
    } catch { /* ignore malformed href */ }
  }
  return out;
}

async function fetchWithTimeout(url, options = {}, ms = PROVIDER_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`HTTP TIMEOUT after ${Math.round(ms / 1000)}s: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url) {
  const r = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'AiVenture-AI-LENS/1.0', 'Accept': 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.8,*/*;q=0.5' },
    redirect: 'follow'
  });
  const raw = await r.text();
  return { url: r.url, status: r.status, text: stripHtml(raw).slice(0, 9000), rawForLinks: raw };
}

// Homepage first, then sitemap.xml order if present, else same-domain links from the homepage.
async function discoverPages(target, maxPages) {
  let home;
  try { home = await getText(target); } catch { return []; }
  const pages = [{ url: home.url, status: home.status, text: home.text }];
  if (home.status >= 400) return pages;

  let candidateUrls = [];
  try {
    const smUrl = new URL('/sitemap.xml', home.url).href;
    const r = await fetchWithTimeout(smUrl, { headers: { 'User-Agent': 'AiVenture-AI-LENS/1.0' } });
    if (r.ok) {
      const xml = await r.text();
      const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)].map(m => m[1].trim());
      candidateUrls = locs.filter(u => {
        try { return new URL(u).origin === new URL(home.url).origin; } catch { return false; }
      });
    }
  } catch { /* no sitemap, fall through */ }

  if (!candidateUrls.length) {
    candidateUrls = linksFrom(home.rawForLinks, home.url);
  }

  for (const u of candidateUrls) {
    if (pages.length >= maxPages) break;
    if (u === home.url || pages.some(p => p.url === u)) continue;
    try {
      const p = await getText(u);
      if (p.status < 500) pages.push({ url: p.url, status: p.status, text: p.text });
    } catch { /* skip unreachable page */ }
  }
  return pages;
}

function fieldsPrompt(pageUrl, accumulatedText) {
  return `You are reconstructing a business, one real page at a time, from the material actually read so far — nothing else.
Do not use prior knowledge of this company. Do not guess. If something is not in the material below, say null.
Answer as commercial questions, not a technical inventory — this is for a business owner, not an engineer.

Material read so far (in the order it was read):
${accumulatedText}

Return STRICT JSON only, no prose before or after, with exactly these keys. Each value is either null, or a short (max 20 words) factual answer to that question, based only on THIS material:
{"WHO":null,"OFFER":null,"AUDIENCE":null,"PROBLEM":null,"VALUE":null,"WHY_YOU":null,"EVIDENCE":null,"COMPETITION":null,"HOW_TO_BUY":null}

WHO = Who is this? Legal/brand identity, category, entity. OFFER = What do they sell? Products/services, as actually described. AUDIENCE = Who is it for? ICP, industry, size, geography. PROBLEM = What need/problem does this solve? Stated use cases or pain points. VALUE = What value/outcome do they deliver? Benefits, results, not just features. WHY_YOU = Why this company specifically? Stated differentiators versus a generic alternative. EVIDENCE = What proves the claims? Named responsible people, credentials, certifications, case studies, cryptographic/documentary proof, trust signals. COMPETITION = Compared to whom? The category this sits in, and any named or implied alternatives. HOW_TO_BUY = How does someone actually engage? Contact path, quote/consultation process, pricing/terms, call to action.`;
}

function parseFieldsJson(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return { parsed: null, ok: false };
  try {
    const obj = JSON.parse(m[0]);
    const out = {};
    for (const f of FIELDS) out[f] = (typeof obj[f] === 'string' && obj[f].trim()) ? obj[f].trim() : null;
    return { parsed: out, ok: true };
  } catch { return { parsed: null, ok: false }; }
}

async function walkProvider(env, name, target, pages, send) {
  const caller = { ChatGPT: callOpenAI, Claude: callClaude, Gemini: callGemini, Perplexity: callPerplexity }[name];
  let corpus = '';
  let prevFields = Object.fromEntries(FIELDS.map(f => [f, null]));
  const firstSeenAt = {}; // field -> page_index (1-based) where it first became non-null
  const trace = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    corpus += `\n\n--- SOURCE: ${page.url} ---\n${page.text}`;
    if (corpus.length > MAX_CORPUS_CHARS) corpus = corpus.slice(corpus.length - MAX_CORPUS_CHARS);

    let fields = prevFields;
    let status = 'OK';
    let errorMsg = null;
    try {
      const raw = await withTimeout(() => caller(env, fieldsPrompt(page.url, corpus)), `${name} page ${i + 1}`);
      const { parsed, ok } = parseFieldsJson(raw);
      if (ok) fields = parsed;
      else { status = 'PARSE_FAILED'; }
    } catch (e) {
      status = 'NOT_MEASURED';
      errorMsg = String(e?.message || e);
      fields = prevFields; // carry forward rather than losing everything on one bad step
    }

    const newFields = FIELDS.filter(f => prevFields[f] == null && fields[f] != null);
    for (const f of newFields) firstSeenAt[f] = i + 1;

    const step = { provider: name, page_index: i + 1, page_url: page.url, status, error: errorMsg, new_fields: newFields, fields };
    trace.push(step);
    send({ type: 'step', ...step, pages_total: pages.length });

    prevFields = fields;
  }

  const neverFound = FIELDS.filter(f => prevFields[f] == null);
  return { provider: name, final_fields: prevFields, first_seen_at: firstSeenAt, never_found: neverFound, trace };
}

async function synthesize(env, target, providerResults) {
  const evidence = JSON.stringify({
    target,
    providers: Object.fromEntries(PROVIDERS.map(p => [p, {
      final_fields: providerResults[p]?.final_fields || {},
      first_seen_at: providerResults[p]?.first_seen_at || {},
      never_found: providerResults[p]?.never_found || FIELDS
    }]))
  }).slice(0, 60000);

  const prompt = `You are producing a direct, plain-language synthesis for a business owner, not a report for engineers.
Below is, for 4 AI systems (ChatGPT, Claude, Gemini, Perplexity), which page of the website first made each business fact reconstructable, and which facts were never found by that AI within the pages it was given.

Evidence:
${evidence}

Return STRICT JSON only:
{
  "table": [ {"field":"WHO","ChatGPT":"page 1|NEVER","Claude":"...","Gemini":"...","Perplexity":"..."} , ... one row per field ... ],
  "measures": ["short, concrete, ranked action - e.g. Move founder credentials to the homepage, 3 of 4 AIs never found them.", "..."],
  "summary": "2-3 sentence plain-language summary of the single biggest problem this run shows."
}
No remediation about technical causes (robots.txt, indexing, ranking) unless the evidence itself states it - only what page/content placement would plausibly fix, since that's what this evidence can actually support.`;

  const normalizers = [
    ['OpenAI', () => callOpenAI(env, prompt)],
    ['Claude', () => callClaude(env, prompt)],
    ['Gemini', () => callGemini(env, prompt)]
  ];
  for (const [name, fn] of normalizers) {
    try {
      const raw = await withTimeout(fn, `synthesis/${name}`);
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        return { table: parsed.table || [], measures: parsed.measures || [], summary: parsed.summary || '', normalizer: name };
      }
    } catch { /* try next normalizer */ }
  }
  return {
    table: FIELDS.map(f => ({
      field: f,
      ...Object.fromEntries(PROVIDERS.map(p => [p, providerResults[p]?.first_seen_at?.[f] ? `page ${providerResults[p].first_seen_at[f]}` : 'NEVER']))
    })),
    measures: [],
    summary: 'Synthesis providers were unavailable; showing raw first-seen data only.',
    normalizer: 'NONE'
  };
}

function withTimeout(promiseFactory, label, ms = PROVIDER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(`${label} TIMEOUT after ${Math.round(ms / 1000)}s`)); } }, ms);
    Promise.resolve().then(promiseFactory)
      .then(v => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } })
      .catch(e => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
  });
}

async function callOpenAI(env, prompt) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const body = { model: env.OPENAI_MODEL || 'gpt-5.6-terra', input: prompt };
  const r = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'OpenAI HTTP ' + r.status);
  return j.output_text || j.output?.flatMap(o => o.content || []).map(c => c.text || '').join('\n') || 'NO_TEXT_OUTPUT';
}

async function callClaude(env, prompt) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const body = { model: env.ANTHROPIC_MODEL || 'claude-sonnet-5', max_tokens: 800, messages: [{ role: 'user', content: prompt }] };
  const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Anthropic HTTP ' + r.status);
  return (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n') || 'NO_TEXT_OUTPUT';
}

async function callGemini(env, prompt) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Gemini HTTP ' + r.status);
  return j.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('\n') || 'NO_TEXT_OUTPUT';
}

async function callPerplexity(env, prompt) {
  if (!env.PERPLEXITY_API_KEY) throw new Error('PERPLEXITY_API_KEY not configured');
  const r = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.PERPLEXITY_MODEL || 'sonar-pro', messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Perplexity HTTP ' + r.status);
  return j.choices?.[0]?.message?.content || 'NO_TEXT_OUTPUT';
}

// /api/lens-market  (AI-LENS "Market View" / P8)
//
// Different question from /api/lens-run on purpose:
//   /api/lens-run  = "What can an AI reconstruct FROM my site, page by page?"
//   /api/lens-market = "When a real customer has the need I solve, does an AI
//                       suggest me at all — and against whom?"
//
// This does NOT feed the AI any of the target's own page text. It asks a natural
// question (the client's intent, typed by the business owner — never inferred from
// the site) with real web search enabled, exactly like a prospect would ask.
// Runs the 4 providers SEQUENTIALLY (ChatGPT fully done, then Claude, then Gemini,
// then Perplexity), matching /api/lens-run's behaviour.

const enc = new TextEncoder();
const PROVIDERS = ['ChatGPT','Claude','Gemini','Perplexity'];
const PROVIDER_TIMEOUT_MS = 30000;

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const intent = String(body.client_intent || '').trim();
  const targetName = String(body.target_name || '').trim();
  const targetUrl = String(body.target_url || '').trim();
  if (!intent) return Response.json({ error: 'client_intent is required — describe what the ideal customer is looking for.' }, { status: 400 });
  if (!targetName) return Response.json({ error: 'target_name is required — how the AI should recognise your company.' }, { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        send({ type: 'session', client_intent: intent, target_name: targetName, target_url: targetUrl });

        const providerResults = {};
        for (const name of PROVIDERS) {
          send({ type: 'market_provider_start', provider: name });
          providerResults[name] = await walkMarket(context.env, name, intent, targetName, targetUrl, (evt) => send(evt));
          send({ type: 'market_provider_done', provider: name });
        }

        send({ type: 'synthesizing' });
        const synthesis = await synthesize(context.env, intent, targetName, providerResults);
        send({ type: 'market_synthesis', ...synthesis });

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

async function fetchWithTimeout(url, options = {}, ms = PROVIDER_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...options, signal: ac.signal }); }
  catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`HTTP TIMEOUT after ${Math.round(ms / 1000)}s`);
    throw e;
  } finally { clearTimeout(timer); }
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

function candidatesPrompt(intent, targetName, targetUrl) {
  return `A potential customer has this need, in their own words: "${intent}"

Using your normal knowledge and current web search, if this person asked you for recommendations, which companies or services would you actually suggest? Be honest and natural — do not force any particular company into the list.

Then specifically check: would "${targetName}"${targetUrl ? ' (' + targetUrl + ')' : ''} be among your natural suggestions for this need?

Return STRICT JSON only, no prose before or after:
{"candidates":[{"name":"...","why":"one short reason, max 15 words"} , ... up to 8, in the order you would naturally mention them ...],
 "target_present": true or false,
 "target_position": null or the 1-based rank of "${targetName}" if it appears in candidates,
 "target_note": "one honest sentence on why it would or would not naturally come up for this need"}`;
}

function comparisonPrompt(intent, targetName, altNames) {
  return `For this customer need: "${intent}"
Compare "${targetName}" directly against ${altNames.join(' and ')} — the other options you just named.

Return STRICT JSON only:
{"comparison":"2-4 sentences: relative strengths/weaknesses of each, and which a customer would more likely pick and why — be direct, not diplomatic"}`;
}

function parseJson(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function walkMarket(env, name, intent, targetName, targetUrl, send) {
  const caller = { ChatGPT: callOpenAI, Claude: callClaude, Gemini: callGemini, Perplexity: callPerplexity }[name];
  let result = { provider: name, status: 'OK', candidates: [], target_present: false, target_position: null, target_note: null, comparison: null };

  try {
    const raw = await withTimeout(() => caller(env, candidatesPrompt(intent, targetName, targetUrl), true), `${name} candidates`);
    const parsed = parseJson(raw);
    if (!parsed) { result.status = 'PARSE_FAILED'; }
    else {
      result.candidates = Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 8) : [];
      result.target_present = Boolean(parsed.target_present);
      result.target_position = (typeof parsed.target_position === 'number') ? parsed.target_position : null;
      result.target_note = typeof parsed.target_note === 'string' ? parsed.target_note : null;
    }
  } catch (e) {
    result.status = 'NOT_MEASURED';
    result.error = String(e?.message || e);
  }
  send({ type: 'market_candidates', provider: name, ...result });

  if (result.status === 'OK' && result.target_present && result.candidates.length > 1) {
    const alts = result.candidates.filter(c => c.name && c.name.toLowerCase() !== targetName.toLowerCase()).slice(0, 2).map(c => c.name);
    if (alts.length) {
      try {
        const raw2 = await withTimeout(() => caller(env, comparisonPrompt(intent, targetName, alts), false), `${name} comparison`);
        const parsed2 = parseJson(raw2);
        result.comparison = parsed2?.comparison || null;
      } catch (e) {
        result.comparison_error = String(e?.message || e);
      }
      send({ type: 'market_comparison', provider: name, comparison: result.comparison, comparison_error: result.comparison_error || null });
    }
  }

  return result;
}

async function synthesize(env, intent, targetName, providerResults) {
  const evidence = JSON.stringify({
    intent, target: targetName,
    providers: Object.fromEntries(PROVIDERS.map(p => [p, {
      present: providerResults[p]?.target_present,
      position: providerResults[p]?.target_position,
      note: providerResults[p]?.target_note,
      candidates: (providerResults[p]?.candidates || []).map(c => c.name),
      comparison: providerResults[p]?.comparison
    }]))
  }).slice(0, 40000);

  const prompt = `You are producing a direct, plain-language synthesis for a business owner.
Below is, for 4 AI systems, whether they would naturally suggest "${targetName}" for this customer need: "${intent}" — and if so, at what position, against whom, and why or why not.

Evidence:
${evidence}

Return STRICT JSON only:
{
  "table": [ {"provider":"ChatGPT","present":"YES (position 2)|NO","named_with":"comma-separated other names mentioned, or none","verdict":"one short honest line"} , one row per provider ],
  "measures": ["short, concrete, ranked action based only on what this evidence shows", "..."],
  "summary": "2-3 sentence plain-language summary of whether this company shows up in the market view, and the single biggest pattern across the 4 AIs."
}
Do not claim this proves how any AI will behave for every user or every phrasing — say so if relevant. No technical root cause.`;

  const normalizers = [
    ['OpenAI', () => callOpenAI(env, prompt, false)],
    ['Claude', () => callClaude(env, prompt, false)],
    ['Gemini', () => callGemini(env, prompt, false)]
  ];
  for (const [name, fn] of normalizers) {
    try {
      const raw = await withTimeout(fn, `market-synthesis/${name}`);
      const parsed = parseJson(raw);
      if (parsed) return { table: parsed.table || [], measures: parsed.measures || [], summary: parsed.summary || '', normalizer: name };
    } catch { /* try next */ }
  }
  return {
    table: PROVIDERS.map(p => ({
      provider: p,
      present: providerResults[p]?.target_present ? `YES (position ${providerResults[p]?.target_position ?? '?'})` : 'NO',
      named_with: (providerResults[p]?.candidates || []).map(c => c.name).filter(n => n && n.toLowerCase() !== targetName.toLowerCase()).slice(0, 3).join(', ') || 'none',
      verdict: providerResults[p]?.target_note || ''
    })),
    measures: [],
    summary: 'Synthesis providers were unavailable; showing raw per-provider data only.',
    normalizer: 'NONE'
  };
}

async function callOpenAI(env, prompt, web) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const body = { model: env.OPENAI_MODEL || 'gpt-5.6-terra', input: prompt };
  if (web) body.tools = [{ type: 'web_search' }];
  const r = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'OpenAI HTTP ' + r.status);
  return j.output_text || j.output?.flatMap(o => o.content || []).map(c => c.text || '').join('\n') || 'NO_TEXT_OUTPUT';
}

async function callClaude(env, prompt, web) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const body = { model: env.ANTHROPIC_MODEL || 'claude-sonnet-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] };
  if (web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Anthropic HTTP ' + r.status);
  return (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n') || 'NO_TEXT_OUTPUT';
}

async function callGemini(env, prompt, web) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  if (web) body.tools = [{ google_search: {} }];
  const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Gemini HTTP ' + r.status);
  return j.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('\n') || 'NO_TEXT_OUTPUT';
}

async function callPerplexity(env, prompt) {
  // Perplexity's Sonar models search by default — no separate "web" toggle needed.
  if (!env.PERPLEXITY_API_KEY) throw new Error('PERPLEXITY_API_KEY not configured');
  const r = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.PERPLEXITY_MODEL || 'sonar-pro', messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Perplexity HTTP ' + r.status);
  return j.choices?.[0]?.message?.content || 'NO_TEXT_OUTPUT';
}

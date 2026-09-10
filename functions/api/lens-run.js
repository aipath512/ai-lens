const enc = new TextEncoder();

const PROVIDERS = ['ChatGPT','Claude','Gemini','Perplexity'];
const FIELDS = ['IDENTITY','OFFER','AUDIENCE','PROBLEMS','VALUE','DIFFERENTIATORS','TRUST_EVIDENCE','PEOPLE','LOCATION','OPERATING_MODEL','CONTACT_ACTION','COMPETITIVE_CONTEXT','UNKNOWNS'];
const DEFAULT_MAX_PAGES = 25;
const HARD_MAX_PAGES = 100;
const FETCH_TIMEOUT_MS = 15000;
const PROVIDER_TIMEOUT_MS = 45000;
const PAGE_TEXT_LIMIT = 14000;

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); }
  catch { return Response.json({error:'Invalid JSON'}, {status:400}); }

  const target = normalizeUrl(body.target_url || '');
  if (!target) return Response.json({error:'Valid target_url required'}, {status:400});
  const maxPages = clamp(Number(body.max_pages) || DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
  const sessionId = String(body.session_id || `S${Date.now()}`);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        send({type:'session', session_id:sessionId, target_url:target, providers:PROVIDERS, max_pages:maxPages, mode:'WEB_AI_BUSINESS_OBSERVATION'});

        send({type:'phase', phase:'DISCOVER', status:'RUNNING'});
        const discovery = await discoverSite(target, maxPages);
        if (!discovery.pages.length) {
          send({type:'phase', phase:'DISCOVER', status:'FAIL', error:'Target could not be fetched'});
          send({type:'job_end', status:'FAIL', return_code:'0008'});
          controller.close();
          return;
        }
        send({type:'discovery', status:'COMPLETE', sitemap_status:discovery.sitemapStatus, sitemap_urls:discovery.sitemapUrls, pages:discovery.pages.map((p,i)=>({index:i+1,url:p.url,status:p.status,title:p.title}))});

        const results = {};
        for (let pIndex=0; pIndex<PROVIDERS.length; pIndex++) {
          const provider = PROVIDERS[pIndex];
          send({type:'provider_start', provider, provider_index:pIndex+1, provider_total:PROVIDERS.length, pages_total:discovery.pages.length});
          results[provider] = await walkProvider(context.env, provider, discovery.pages, send);
          send({type:'provider_done', provider, status:results[provider].status, model:results[provider].model, final_memory:results[provider].final_memory, pages_completed:results[provider].pages_completed, pages_total:discovery.pages.length});
        }

        send({type:'phase', phase:'MERGE', status:'RUNNING'});
        const merge = buildDeterministicMerge(results, discovery.pages);
        send({type:'merge', ...merge});

        let executive = null;
        try { executive = await executiveSynthesis(context.env, target, merge, results); }
        catch (e) { executive = {status:'NOT_MEASURED', summary:'Cross-AI synthesis model unavailable.', actions:[], error:String(e?.message||e)}; }
        send({type:'executive', ...executive});
        send({type:'handoff', destination:'3WEBOBS', scope:'Investigate WHY the observed business-information losses/divergences occur. AI-LENS itself does not diagnose technical root cause.'});
        send({type:'job_end', status:'COMPLETE', return_code:'0000'});
      } catch(e) {
        send({type:'job_end', status:'FAIL', return_code:'9999', error:String(e?.message||e)});
      } finally { controller.close(); }
    }
  });

  return new Response(stream, {headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function normalizeUrl(v){ try { v=String(v).trim(); if(!/^https?:\/\//i.test(v)) v='https://'+v; const u=new URL(v); return ['http:','https:'].includes(u.protocol)?u.href:null; } catch { return null; } }
function sameOrigin(a,b){ try{return new URL(a).origin===new URL(b).origin;}catch{return false;} }
function decodeEntities(s){ return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"); }
function stripHtml(raw){ return decodeEntities(String(raw||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()); }
function titleFrom(raw){ const m=String(raw||'').match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m?stripHtml(m[1]).slice(0,180):''; }

async function fetchTimeout(url, options={}, ms=FETCH_TIMEOUT_MS){
  const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),ms);
  try { return await fetch(url,{...options,signal:ac.signal,redirect:'follow'}); }
  finally { clearTimeout(t); }
}

async function fetchPage(url){
  const r=await fetchTimeout(url,{headers:{'User-Agent':'AiVenture-AI-LENS/6.0 (+https://ai-lens.eu)','Accept':'text/html,application/xhtml+xml,text/plain,application/xml;q=0.8,*/*;q=0.5'}});
  const ct=r.headers.get('content-type')||'';
  const raw=await r.text();
  return {url:r.url,status:r.status,content_type:ct,title:titleFrom(raw),text:stripHtml(raw).slice(0,PAGE_TEXT_LIMIT),raw};
}

async function discoverSite(target,maxPages){
  let home;
  try { home=await fetchPage(target); } catch { return {pages:[],sitemapStatus:'HOME_FETCH_FAILED',sitemapUrls:[]}; }
  const pages=[home];
  const sitemapUrls=[];
  const discovered=[];
  const origin=new URL(home.url).origin;

  const robotsCandidates=[];
  try {
    const rr=await fetchTimeout(new URL('/robots.txt',home.url).href,{headers:{'User-Agent':'AiVenture-AI-LENS/6.0'}});
    if(rr.ok){ const rt=await rr.text(); for(const m of rt.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) robotsCandidates.push(m[1].trim()); }
  } catch {}
  const seedSitemaps=[...new Set([...robotsCandidates,new URL('/sitemap.xml',home.url).href])];
  const seenSitemaps=new Set();

  async function parseSitemap(smUrl,depth=0){
    if(depth>3||seenSitemaps.has(smUrl)||discovered.length>=maxPages*4) return;
    seenSitemaps.add(smUrl);
    try {
      const r=await fetchTimeout(smUrl,{headers:{'User-Agent':'AiVenture-AI-LENS/6.0','Accept':'application/xml,text/xml,text/plain,*/*'}});
      if(!r.ok) return;
      const xml=await r.text(); sitemapUrls.push(smUrl);
      const locs=[...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map(m=>decodeEntities(m[1].trim()));
      const isIndex=/<sitemapindex[\s>]/i.test(xml);
      for(const loc of locs){
        if(isIndex) await parseSitemap(loc,depth+1);
        else if(sameOrigin(loc,origin)&&!discovered.includes(loc)) discovered.push(loc);
        if(discovered.length>=maxPages*4) break;
      }
    } catch {}
  }
  for(const sm of seedSitemaps) await parseSitemap(sm);

  if(!discovered.length){
    for(const m of home.raw.matchAll(/href=["']([^"'#]+)["']/gi)){
      try { const u=new URL(m[1],home.url).href; if(sameOrigin(u,origin)&&!discovered.includes(u)) discovered.push(u); } catch {}
    }
  }

  for(const u of discovered){
    if(pages.length>=maxPages) break;
    if(pages.some(p=>canonicalNoHash(p.url)===canonicalNoHash(u))) continue;
    try { const p=await fetchPage(u); if(p.status<500) pages.push(p); } catch {}
  }
  return {pages,sitemapStatus:sitemapUrls.length?'FOUND':'FALLBACK_HOME_LINKS',sitemapUrls};
}
function canonicalNoHash(u){ try{const x=new URL(u);x.hash='';return x.href;}catch{return u;} }

function initialMemory(){ return Object.fromEntries(FIELDS.map(f=>[f,[]])); }
function compactMemory(mem){ const o={}; for(const f of FIELDS) o[f]=(mem[f]||[]).slice(-12); return o; }

function pagePrompt(provider,page,pageIndex,total,memory){
  return `AI-LENS WEB-AI BUSINESS OBSERVATION\n\nYou are ${provider}. You are observing ONE website page in a controlled sequential experiment.\nDo not use external search, prior knowledge, or information not present in CURRENT PAGE plus PRIOR MEMORY.\nThe goal is business reconstruction, not SEO/audit.\n\nPAGE ${pageIndex}/${total}\nURL: ${page.url}\nTITLE: ${page.title||''}\n\nPRIOR MEMORY FROM EARLIER PAGES OF THIS SAME WEBSITE:\n${JSON.stringify(compactMemory(memory))}\n\nCURRENT PAGE TEXT:\n${page.text}\n\nReturn STRICT JSON only with this structure:\n{\n "page_observation": {\n   "IDENTITY": [], "OFFER": [], "AUDIENCE": [], "PROBLEMS": [], "VALUE": [], "DIFFERENTIATORS": [],\n   "TRUST_EVIDENCE": [], "PEOPLE": [], "LOCATION": [], "OPERATING_MODEL": [], "CONTACT_ACTION": [],\n   "COMPETITIVE_CONTEXT": [], "UNKNOWNS": []\n },\n "updated_memory": { same 13 keys, each an array of concise factual strings },\n "page_business_summary": "max 80 words",\n "new_information": ["facts newly added on this page"],\n "conflicts": ["only conflicts between current page and prior memory"],\n "confidence": "HIGH|MEDIUM|LOW"\n}\nRules: preserve specificity; do not invent competitors; COMPETITIVE_CONTEXT only if explicitly stated/implied by category or alternatives on the page; every factual memory item must be supportable by this site material.`;
}

async function walkProvider(env,provider,pages,send){
  const caller={ChatGPT:callOpenAI,Claude:callClaude,Gemini:callGemini,Perplexity:callPerplexity}[provider];
  let memory=initialMemory(); const trace=[]; let model=''; let providerStatus='PASS'; let completed=0;
  for(let i=0;i<pages.length;i++){
    send({type:'page_start',provider,page_index:i+1,pages_total:pages.length,page_url:pages[i].url});
    try{
      const resp=await withTimeout(()=>caller(env,pagePrompt(provider,pages[i],i+1,pages.length,memory)),`${provider} page ${i+1}`);
      model=resp.model||model;
      const parsed=parseJson(resp.text);
      if(!parsed||!parsed.updated_memory) throw new Error('Invalid JSON returned by provider');
      memory=normalizeMemory(parsed.updated_memory,memory);
      const step={type:'page_result',provider,model,page_index:i+1,pages_total:pages.length,page_url:pages[i].url,status:'PASS',page_observation:parsed.page_observation||{},new_information:parsed.new_information||[],conflicts:parsed.conflicts||[],page_business_summary:parsed.page_business_summary||'',confidence:parsed.confidence||'LOW',memory_snapshot:memory};
      trace.push(step); completed++; send(step);
    }catch(e){
      providerStatus='PARTIAL';
      const step={type:'page_result',provider,model,page_index:i+1,pages_total:pages.length,page_url:pages[i].url,status:'NOT_MEASURED',error:String(e?.message||e),page_observation:{},new_information:[],conflicts:[],page_business_summary:'',confidence:'LOW',memory_snapshot:memory};
      trace.push(step); send(step);
    }
  }
  if(completed===0) providerStatus='NOT_MEASURED';
  return {status:providerStatus,model,final_memory:memory,pages_completed:completed,trace};
}

function normalizeMemory(candidate,previous){
  const out={};
  for(const f of FIELDS){
    const arr=Array.isArray(candidate?.[f])?candidate[f]:previous[f]||[];
    out[f]=[...new Set(arr.map(x=>String(x).trim()).filter(Boolean))].slice(0,40);
  }
  return out;
}
function parseJson(raw){
  const s=String(raw||'').trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(s);}catch{}
  const a=s.indexOf('{'), b=s.lastIndexOf('}'); if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch{}}
  return null;
}

function buildDeterministicMerge(results,pages){
  const matrix=[];
  for(const field of FIELDS){
    const row={field}; let available=0;
    const normalizedSets=[];
    for(const p of PROVIDERS){
      const vals=results[p]?.final_memory?.[field]||[];
      row[p]=vals; if(vals.length) available++;
      normalizedSets.push(new Set(vals.map(normFact)));
    }
    row.coverage=`${available}/4`;
    row.state=available===4?'STABLE_COVERAGE':available>=2?'VARIABLE':available===1?'FRAGILE':'MISSING';
    matrix.push(row);
  }
  return {status:'COMPLETE',pages_total:pages.length,matrix,providers:Object.fromEntries(PROVIDERS.map(p=>[p,{status:results[p]?.status||'NOT_MEASURED',model:results[p]?.model||'',pages_completed:results[p]?.pages_completed||0}]))};
}
function normFact(s){ return String(s).toLowerCase().replace(/[^a-z0-9ăâîșț]+/gi,' ').trim(); }

async function executiveSynthesis(env,target,merge,results){
  const compact={target,matrix:merge.matrix.map(r=>({field:r.field,state:r.state,coverage:r.coverage,...Object.fromEntries(PROVIDERS.map(p=>[p:(r[p]||[]).slice(0,12)]))}))};
  const prompt=`You are AI-LENS final cross-AI business-information synthesizer.\nInput contains four independent website reconstructions after each AI traversed the same HOME+sitemap page list.\nDo NOT diagnose SEO, robots, schema, ranking, crawler configuration, or technical root cause.\nDo NOT invent competitors.\nReturn strict JSON only:\n{\n "business_view":"concise complete reconstruction",\n "stable":["facts consistently visible"],\n "variable":["facts represented inconsistently"],\n "fragile_missing":["important business facts absent or only weakly reconstructed"],\n "conflicts":["material conflicts across AI views"],\n "why_choose_us":"what differentiating case survives across AI, or INCOMPLETE",\n "actions":[{"priority":1,"what":"business information to improve","where":"page/placement inferred only from supplied observations","why":"business impact"}],\n "handoff_questions_for_3webobs":["technical WHY questions to investigate"]\n}\nEvidence:\n${JSON.stringify(compact).slice(0,100000)}`;
  const fallbacks=[['OpenAI',callOpenAI],['Claude',callClaude],['Gemini',callGemini],['Perplexity',callPerplexity]];
  for(const [name,fn] of fallbacks){
    try{const r=await withTimeout(()=>fn(env,prompt),`merge/${name}`);const j=parseJson(r.text);if(j)return {status:'PASS',normalizer:name,model:r.model,...j};}catch{}
  }
  throw new Error('No provider available for executive synthesis');
}

function withTimeout(factory,label,ms=PROVIDER_TIMEOUT_MS){
  return new Promise((resolve,reject)=>{let done=false;const t=setTimeout(()=>{if(!done){done=true;reject(new Error(`${label} TIMEOUT ${Math.round(ms/1000)}s`));}},ms);Promise.resolve().then(factory).then(v=>{if(!done){done=true;clearTimeout(t);resolve(v);}}).catch(e=>{if(!done){done=true;clearTimeout(t);reject(e);}});});
}

async function callOpenAI(env,prompt){
  if(!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const model=env.OPENAI_MODEL||'gpt-5.6-luna';
  const r=await fetchTimeout('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:prompt,text:{format:{type:'json_object'}}})},PROVIDER_TIMEOUT_MS);
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message||`OpenAI HTTP ${r.status}`);
  const text=j.output_text||j.output?.flatMap(o=>o.content||[]).map(c=>c.text||'').join('\n')||'';
  return {model,text};
}

async function callClaude(env,prompt){
  if(!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const model=env.ANTHROPIC_MODEL||'claude-sonnet-5';
  const r=await fetchTimeout('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:2200,messages:[{role:'user',content:prompt}]})},PROVIDER_TIMEOUT_MS);
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message||`Anthropic HTTP ${r.status}`);
  return {model,text:(j.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n')};
}

let geminiModelCache=null;
async function resolveGeminiModel(env){
  if(env.GEMINI_MODEL) return env.GEMINI_MODEL;
  if(geminiModelCache) return geminiModelCache;
  if(!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const r=await fetchTimeout('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':env.GEMINI_API_KEY}},PROVIDER_TIMEOUT_MS);
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message||`Gemini listModels HTTP ${r.status}`);
  const names=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>String(m.name||'').replace(/^models\//,''));
  if(!names.length) throw new Error('No Gemini generateContent model available for this API key');
  const preferred=['gemini-3.7-flash','gemini-3.5-flash','gemini-3-flash','gemini-2.5-flash'];
  geminiModelCache=preferred.find(x=>names.includes(x)) || names.find(x=>/flash/i.test(x)) || names[0];
  return geminiModelCache;
}
async function callGemini(env,prompt){
  if(!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const model=await resolveGeminiModel(env);
  const r=await fetchTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':env.GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json'}})},PROVIDER_TIMEOUT_MS);
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message||`Gemini HTTP ${r.status}`);
  return {model,text:j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n')||''};
}

async function callPerplexity(env,prompt){
  if(!env.PERPLEXITY_API_KEY) throw new Error('PERPLEXITY_API_KEY not configured');
  const model=env.PERPLEXITY_MODEL||'sonar-pro';
  const r=await fetchTimeout('https://api.perplexity.ai/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${env.PERPLEXITY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:prompt}]})},PROVIDER_TIMEOUT_MS);
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message||`Perplexity HTTP ${r.status}`);
  return {model,text:j.choices?.[0]?.message?.content||''};
}

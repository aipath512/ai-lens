const enc = new TextEncoder();
const SESSION = '0002H';

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return Response.json({error:'Invalid JSON'}, {status:400}); }
  const target = normalizeUrl(body.target_url || '');
  if (!target) return Response.json({error:'Valid target_url required'}, {status:400});

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      const stage = (id,status,display,return_code='0004') => send({type:'stage',stage:id,status,display,return_code});
      send({type:'session',session_id: body.session_id || SESSION, target_url: target});
      try {
        stage('P0','RUNNING',displayStart('P0', target, 'CONTROLLED_TARGET_WEBSITE_BASELINE'));
        const baseline = await crawlTarget(target);
        stage('P0', baseline.pages.length ? 'COMPLETE':'PARTIAL', p0Display(target, baseline), baseline.pages.length ? '0004':'0008');

        stage('P1','RUNNING',displayStart('P1', target, 'EXACT_URL_STRICT'));
        const p1 = await runProviders(context.env, exactPagePrompt(target, baseline.homeText));
        stage('P1', aggregateStatus(p1), providerDisplay('P1','EXACT PAGE',p1), codeFor(p1));

        stage('P2','RUNNING',displayStart('P2', target, 'SAME_DOMAIN_STRICT'));
        const p2 = await runProviders(context.env, domainPrompt(target, baseline.corpus));
        stage('P2', aggregateStatus(p2), providerDisplay('P2','SAME DOMAIN',p2), codeFor(p2));

        stage('P3','RUNNING',displayStart('P3', target, 'OPEN_WEB_NATURAL_SELECTION'));
        const p3 = await runNaturalProviders(context.env, target);
        stage('P3', aggregateStatus(p3), providerDisplay('P3','NATURAL DISCOVERY',p3), codeFor(p3));

        const frozen = {target,p0:baseline,p1,p2,p3};
        stage('P4','RUNNING',displayStart('P4', target, 'FROZEN_CHAIN_INFORMATION_SURVIVAL'));
        const analysis = await analyzeFrozen(context.env, frozen);
        stage('P4', analysis ? 'COMPLETE':'PARTIAL', analysis?.p4 || fallbackP4(p1,p2,p3));
        stage('P5','RUNNING',displayStart('P5', target, 'GAP_CLASSIFICATION'));
        stage('P5', analysis ? 'COMPLETE':'PARTIAL', analysis?.p5 || fallbackP5());
        stage('P6','RUNNING',displayStart('P6', target, 'NORMALIZED_AI_VIEW_SETS'));
        stage('P6', analysis ? 'COMPLETE':'PARTIAL', analysis?.p6 || fallbackP6(p3));
        stage('P7','RUNNING',displayStart('P7', target, 'CROSS_AI_MERGE'));
        stage('P7', analysis ? 'COMPLETE':'PARTIAL', analysis?.p7 || fallbackP7(p3));
        send({type:'job_end',return_code:'0004'});
      } catch (e) {
        send({type:'job_end',return_code:'9999',error:String(e?.message || e)});
      } finally { controller.close(); }
    }
  });
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'}});
}

function normalizeUrl(v){try{v=String(v||'').trim();if(!/^https?:\/\//i.test(v))v='https://'+v;const u=new URL(v);return u.protocol==='https:'||u.protocol==='http:'?u.href:null}catch{return null}}
function stripHtml(html){return String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function linksFrom(html,base){const out=[];const re=/href=["']([^"'#]+)["']/gi;let m;while((m=re.exec(html))){try{const u=new URL(m[1],base);if(u.origin===new URL(base).origin&&!out.includes(u.href))out.push(u.href)}catch{}}return out}
async function getText(url){const r=await fetch(url,{headers:{'User-Agent':'AiVenture-AI-LENS/1.0','Accept':'text/html,application/xhtml+xml,application/xml,text/plain;q=0.8,*/*;q=0.5'},redirect:'follow'});const ct=r.headers.get('content-type')||'';const raw=await r.text();return {url:r.url,status:r.status,ct,raw,text:stripHtml(raw).slice(0,18000)}}
async function crawlTarget(target){const home=await getText(target);let urls=linksFrom(home.raw,home.url).slice(0,8);try{const sm=new URL('/sitemap.xml',home.url).href;const r=await fetch(sm,{headers:{'User-Agent':'AiVenture-AI-LENS/1.0'}});if(r.ok){const x=await r.text();const loc=[...x.matchAll(/<loc>(.*?)<\/loc>/gi)].map(m=>m[1].trim());for(const u of loc){try{if(new URL(u).origin===new URL(home.url).origin&&!urls.includes(u))urls.push(u)}catch{}}}}catch{}
  urls=urls.slice(0,10);const pages=[home];for(const u of urls){if(u===home.url)continue;try{const p=await getText(u);if(p.status<500)pages.push(p)}catch{}}
  const corpus=pages.map(p=>`SOURCE: ${p.url}\nSTATUS: ${p.status}\nTEXT: ${p.text}`).join('\n\n---\n\n').slice(0,70000);return {homeUrl:home.url,homeStatus:home.status,homeText:home.text,pages:pages.map(p=>({url:p.url,status:p.status,content_type:p.ct,text:p.text.slice(0,6000)})),corpus};}
function displayStart(p,target,mode){return `DISPLAY ${p} START\nTARGET............. ${target}\nMODE............... ${mode}\nSTATUS............. RUNNING`}
function p0Display(target,b){return `DISPLAY P0 START\nTARGET............. ${target}\nDIRECT_ACCESS....... ${b.homeStatus>=200&&b.homeStatus<400?'YES':'NO'}\nHOME_STATUS......... ${b.homeStatus}\nTARGET_PAGES_READ... ${b.pages.length}\nSAME_DOMAIN_ONLY.... YES\nEXTERNAL_FACTS...... NO\n\nRESOURCES:\n${b.pages.map((p,i)=>String(i+1).padStart(2,'0')+' '+p.status+' '+p.url).join('\n')}\n\nDISPLAY P0 END\nRETURN_CODE......... ${b.pages.length?'0004':'0008'}`}
const baseRules=`Use only the material supplied in this prompt. Never use prior knowledge. Never invent missing facts. Return concise labelled lines for IDENTITY, OFFER, AUDIENCE, LOCATION, PEOPLE, CONTACT, TRUST, DEEP_PROOF, OPERATING_MODEL, DIGITAL_AI, UNKNOWNS, PROVENANCE.`;
function exactPagePrompt(target,text){return `${baseRules}\n\nP1 EXACT PAGE OBSERVATION. Target: ${target}. The following text is ONLY the exact fetched landing page. Do not treat linked pages as read.\n\n${text.slice(0,24000)}`}
function domainPrompt(target,corpus){return `${baseRules}\n\nP2 SAME-DOMAIN BUSINESS RECONSTRUCTION. Target: ${target}. Use only the same-domain fetched corpus below. Cite source URLs in-line.\n\n${corpus}`}
function naturalPrompt(target){return `P3 NATURAL DISCOVERY TEST for ${target}. Use your current web/search capability naturally. Do not systematically enumerate sitemap or force hidden paths. Report SOURCES SELECTED, whether OFFICIAL TARGET selected and directly accessed, then IDENTITY, OFFER, AUDIENCE, LOCATION, PEOPLE, CONTACT, TRUST, DEEP_PROOF, OPERATING_MODEL, DIGITAL_AI, UNKNOWNS, PROVENANCE. Distinguish direct target, external source, snippet, prior context, and inference. Do not claim crawler behavior.`}

async function runProviders(env,prompt){const jobs=[['ChatGPT',()=>callOpenAI(env,prompt,false)],['Claude',()=>callClaude(env,prompt,false)],['Gemini',()=>callGemini(env,prompt,false)],['Perplexity',()=>callPerplexity(env,prompt,false)]];return settle(jobs)}
async function runNaturalProviders(env,target){const prompt=naturalPrompt(target);const jobs=[['ChatGPT',()=>callOpenAI(env,prompt,true)],['Claude',()=>callClaude(env,prompt,true)],['Gemini',()=>callGemini(env,prompt,true)],['Perplexity',()=>callPerplexity(env,prompt,true)]];return settle(jobs)}
async function settle(jobs){const rs=await Promise.all(jobs.map(async([name,fn])=>{try{const text=await fn();return {name,status:'PASS',text}}catch(e){return {name,status:'NOT_MEASURED',text:String(e.message||e)}}}));return rs}
function aggregateStatus(rs){const ok=rs.filter(x=>x.status==='PASS').length;return ok===rs.length?'COMPLETE':ok?'PARTIAL':'FAIL'}
function codeFor(rs){return rs.every(x=>x.status==='PASS')?'0000':rs.some(x=>x.status==='PASS')?'0004':'0008'}
function providerDisplay(stage,label,rs){return `DISPLAY ${stage} START\n${label}\n\n${rs.map(x=>`[${x.name}] ${x.status}\n${x.text.slice(0,5000)}`).join('\n\n--------------------\n\n')}\n\nDISPLAY ${stage} END\nRETURN_CODE......... ${codeFor(rs)}`}

async function callOpenAI(env,prompt,web){if(!env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY not configured');const body={model:env.OPENAI_MODEL||'gpt-5.6-terra',input:prompt};if(web)body.tools=[{type:'web_search'}];const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'OpenAI HTTP '+r.status);return j.output_text||j.output?.flatMap(o=>o.content||[]).map(c=>c.text||'').join('\n')||'NO_TEXT_OUTPUT'}
async function callClaude(env,prompt,web){if(!env.ANTHROPIC_API_KEY)throw new Error('ANTHROPIC_API_KEY not configured');const body={model:env.ANTHROPIC_MODEL||'claude-sonnet-4-5',max_tokens:2200,messages:[{role:'user',content:prompt}]};if(web)body.tools=[{type:'web_search_20250305',name:'web_search',max_uses:5}];const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Anthropic HTTP '+r.status);return (j.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n')||'NO_TEXT_OUTPUT'}
async function callGemini(env,prompt,web){if(!env.GEMINI_API_KEY)throw new Error('GEMINI_API_KEY not configured');const model=env.GEMINI_MODEL||'gemini-3.8-flash';const body={contents:[{parts:[{text:prompt}]}]};if(web)body.tools=[{google_search:{}}];const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Gemini HTTP '+r.status);return j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n')||'NO_TEXT_OUTPUT'}
async function callPerplexity(env,prompt,web){if(!env.PERPLEXITY_API_KEY)throw new Error('PERPLEXITY_API_KEY not configured');const r=await fetch('https://api.perplexity.ai/v1/sonar',{method:'POST',headers:{Authorization:`Bearer ${env.PERPLEXITY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.PERPLEXITY_MODEL||'sonar-pro',messages:[{role:'user',content:prompt}]})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Perplexity HTTP '+r.status);return j.choices?.[0]?.message?.content||'NO_TEXT_OUTPUT'}

async function analyzeFrozen(env,frozen){
  const prompt=`You are the AI-LENS frozen-chain normalizer. NO WEB SEARCH. Use ONLY the JSON evidence below. Never diagnose technical root cause. Never prescribe remediation. Produce STRICT JSON with keys p4,p5,p6,p7, each a concise DISPLAY-style multiline string. P4 compares controlled P1/P2 against P3 and states FULL/DEGRADED/LOST/NOT_MEASURED. P5 classifies ACCESS/RETRIEVAL/UNDERSTANDING/SELECTION/USAGE gaps only when supported. P6 normalizes one view per AI preserving provenance. P7 merges cross-AI agreement/divergence and explicitly states whether there is a single AI view. Evidence:
${JSON.stringify(frozen).slice(0,120000)}`;
  const normalizers=[
    ['OpenAI',()=>callOpenAI(env,prompt,false)],
    ['Claude',()=>callClaude(env,prompt,false)],
    ['Gemini',()=>callGemini(env,prompt,false)]
  ];
  for(const [name,fn] of normalizers){
    try{
      const raw=await fn();
      const m=raw.match(/\{[\s\S]*\}/);
      if(m){const parsed=JSON.parse(m[0]); parsed._normalizer=name; return parsed;}
    }catch{}
  }
  return null;
}
function fallbackP4(p1,p2,p3){return `DISPLAY P4 START\nINFORMATION_SURVIVAL... PARTIAL / NOT FULLY NORMALIZED\nP1_AVAILABLE.......... ${p1.filter(x=>x.status==='PASS').length}/4\nP2_AVAILABLE.......... ${p2.filter(x=>x.status==='PASS').length}/4\nP3_AVAILABLE.......... ${p3.filter(x=>x.status==='PASS').length}/4\nNORMALIZER............ NOT_MEASURED\nDISPLAY P4 END\nRETURN_CODE............ 0004`}
function fallbackP5(){return `DISPLAY P5 START\nGAP_CLASSIFICATION.... NOT_MEASURED\nTECHNICAL_ROOT_CAUSE.. NOT_DIAGNOSED\nREMEDIATION............ NOT_DEFINED\nDISPLAY P5 END\nRETURN_CODE............ 0004`}
function fallbackP6(p3){return `DISPLAY P6 START\n${p3.map(x=>`${x.name.padEnd(20,'.')} ${x.status}`).join('\n')}\nNORMALIZATION.......... NOT_MEASURED\nDISPLAY P6 END\nRETURN_CODE............ 0004`}
function fallbackP7(p3){const ok=p3.filter(x=>x.status==='PASS').length;return `DISPLAY P7 START\nAI_VIEW_SETS_AVAILABLE ${ok}/4\nCROSS_AI_MERGE......... NOT_MEASURED\nSINGLE_AI_VIEW.......... UNKNOWN\nTECHNICAL_ROOT_CAUSE... NOT_DIAGNOSED\nREMEDIATION............. NOT_YET_PROVEN\nDISPLAY P7 END\nRETURN_CODE............. 0004`}

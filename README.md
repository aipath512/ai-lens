# AI-LENS — v4.1 / SESSION 0002H

Cloudflare Pages project. White theme is the default.

## What changed
- AI-LENS branding/canonical metadata corrected for `ai-lens.eu`.
- Existing 167-signal 3WEBOBS deterministic audit preserved.
- Added visible MAINFRAME-style P0→P7 job chain directly below the URL input.
- Each stage has its own COBOL-like program name, status and DISPLAY output.
- Added `/api/lens-run` Cloudflare Pages Function with NDJSON streaming.
- Multi-URL: the entered URL is passed to both the deterministic audit and the AI-LENS orchestration chain.
- No ECBTAX hard-coded results.
- Missing provider keys produce `NOT_MEASURED`, never fabricated output.

## Cloudflare secrets / variables
Configure these server-side (never in `index.html`):

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional; default `gpt-5.6-terra`)
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (optional)
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (optional)
- `PERPLEXITY_API_KEY`
- `PERPLEXITY_MODEL` (optional)

Existing email/lead variables remain unchanged (`RESEND_API_KEY`, etc.).

## Protocol
P0 Baseline → P1 Exact Page → P2 Same Domain → P3 Natural Discovery → P4 Information Survival → P5 Gap Classification → P6 Normalized AI Views → P7 Cross-AI Merge.

P0–P3 observe. P4–P7 use frozen prior-stage evidence. Technical root cause and remediation are explicitly outside AI-LENS and should be handed to 3WEBOBS / AI-READY only after diagnosis.


## v4.1 provider fixes — 2026-09-10
- Gemini default model: `gemini-3.8-flash` (stable GA).
- Perplexity endpoint: `POST https://api.perplexity.ai/v1/sonar` with default model `sonar-pro`.
- P4-P7 frozen-chain normalizer now falls back OpenAI → Claude → Gemini, so OpenAI billing exhaustion does not block the rest of the job.
- Existing Cloudflare secrets remain unchanged: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`.
- Optional overrides: `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `PERPLEXITY_MODEL`.


## v4.2 provider fail-safe
- P1/P2/P3 provider calls have a 30-second hard timeout per provider.
- A dead/slow provider is recorded NOT_MEASURED; the chain continues to the next stage.
- Gemini uses the current generateContent REST endpoint with x-goog-api-key and defaults to gemini-3.8-flash.
- Perplexity uses the still-live Sonar Chat Completions endpoint /chat/completions with sonar-pro.
- No provider can indefinitely block P1 and therefore P2-P7.

## v4.3 — lead capture, session compare, report delivery (2026-09-10)
Fixes five bugs found while diagnosing "doesn't work" reports:
- **Lead capture was 404ing.** The checklist unlock and "email me the report" forms called `/lead`; the actual function is routed at `/api/lead`. Both call sites fixed.
- **`/lead` payload didn't match what `lead.js` expects.** It requires `scanned_url` and `consent: true`; the frontend was sending `url` and no consent field at all, so even a fixed path would have 400'd. Added a real, visible consent checkbox next to the "email me the report" form and corrected the field names.
- **`/api/session` and `/api/session/compare` did not exist.** The BEFORE/AFTER session-comparison bar called them and silently stayed hidden forever. Built from scratch — see "Session storage" below.
- **The report was never actually emailed.** `functions/api/send-report.js` (Resend integration) was fully implemented but never called from `index.html`. `submitLead()` now calls it after the lead is stored, and only claims "on the way" once Resend confirms.
- **Claude default model was stale.** `lens-run.js` defaulted `ANTHROPIC_MODEL` to `claude-sonnet-4-5`, which does not exist — every Claude call in P0–P7 failed silently to `NOT_MEASURED`. Fixed to `claude-sonnet-5`.
- Added the missing `/assets/ai-readiness-checklist.pdf` (condensed, real excerpt of the 30 highest-weighted signals out of the 167 in `SIG`, not placeholder text).

### Session storage
`/api/session` and `/api/session/compare` need a Cloudflare KV namespace bound as `AI_LENS_SESSIONS`:
1. Cloudflare dashboard → Workers & Pages → KV → Create namespace → name it (e.g. `ai-lens-sessions`).
2. Copy its ID, paste it into `wrangler.toml` under `[[kv_namespaces]] id = "..."`.
3. Pages project → Settings → Functions → KV namespace bindings → add `AI_LENS_SESSIONS` → the namespace you just created.
4. Redeploy.

Until that binding exists, `GET /api/session` still returns a working default (`0002H`) and the page loads normally; `POST /api/session` (recording an observation) returns `501` instead of pretending to have saved anything, and `/api/session/compare` returns `0` observations with an explanatory `note` rather than fabricating a delta.

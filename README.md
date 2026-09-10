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

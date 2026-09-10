# AI-LENS v6.0 — Web-AI Business Observation

Purpose: reconstruct what four AI systems understand about a business from its own website, page by page.

Execution:
1. User enters a URL.
2. AI-LENS fetches HOME and discovers sitemap(s), including sitemap indexes.
3. Ordered page list is frozen for the run.
4. ChatGPT traverses every page sequentially and builds an incremental business memory; its final view is frozen.
5. Claude starts from empty memory and traverses the identical page list; freeze.
6. Gemini does the same; freeze.
7. Perplexity does the same; freeze.
8. AI-LENS builds the Cross-AI Business Information Matrix.
9. AI-LENS identifies stable, variable, fragile/missing business information and action candidates.
10. Handoff to 3WEBOBS for technical WHY diagnosis.

This project intentionally does NOT run the 167-signal 3WEBOBS audit inside AI-LENS.

## Cloudflare Pages secrets
- OPENAI_API_KEY
- ANTHROPIC_API_KEY
- GEMINI_API_KEY
- PERPLEXITY_API_KEY

Optional model overrides:
- OPENAI_MODEL (default gpt-5.6-luna)
- ANTHROPIC_MODEL (default claude-sonnet-5)
- GEMINI_MODEL (otherwise auto-detected from models supporting generateContent)
- PERPLEXITY_MODEL (default sonar-pro)

## Endpoint
POST /api/lens-run
JSON: {"target_url":"https://example.com","max_pages":25,"session_id":"0003H"}
Response: NDJSON stream.

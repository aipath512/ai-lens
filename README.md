# AI-LENS v6.1 — Independent Multi-Model Business Observation

Purpose: reconstruct and compare what leading AI systems understand about a business from its public digital information. AI-LENS is an independent multi-model observation product.

## Site View execution
1. User enters a URL.
2. AI-LENS fetches HOME and discovers sitemap(s), including sitemap indexes.
3. The ordered page list is frozen for the run.
4. ChatGPT traverses every page sequentially and builds an incremental business memory; its final view is frozen.
5. Claude starts from empty memory and traverses the identical page list; freeze.
6. Gemini does the same; freeze.
7. Perplexity does the same; freeze.
8. AI-LENS builds the Cross-AI Business Information Matrix.
9. AI-LENS identifies stable, variable, fragile/missing business information and action candidates.

## Market View
`/api/lens-market` independently asks the same four AI systems what they find/recommend for a customer intent using their available web-search path, then compares whether and how the target business appears.

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

## Endpoints
POST `/api/lens-run`
JSON: `{"target_url":"https://example.com","max_pages":25,"session_id":"0003H"}`
Response: NDJSON stream.

POST `/api/lens-market`
Market-view multi-model observation.

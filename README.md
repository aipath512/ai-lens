# AI LENS™ Lead Magnet — 1clic-ia.eu

## What this package contains

- `index.html` — independent AI LENS™ lead magnet page
- `functions/api/lead.js` — Cloudflare Pages Function to capture leads
- `_headers` — basic security headers
- `wrangler.toml` — optional Cloudflare project config

## How it works

1. Visitor enters website URL.
2. Visitor enters email or WhatsApp.
3. Visitor accepts consent.
4. AI LENS™ scan runs.
5. Results are shown.
6. Lead is sent to `/api/lead`.
7. Lead can be stored in Cloudflare KV and/or sent to Airtable, Make, Zapier, Google Sheets, Zoho CRM.

## Cloudflare Pages deployment

Upload these files to the root of the `1clic-ia.eu` GitHub repository:

```text
/index.html
/functions/api/lead.js
/_headers
/wrangler.toml
```

Then deploy through Cloudflare Pages.

## Optional KV storage

In Cloudflare Pages:

1. Go to your Pages project.
2. Settings → Functions → KV namespace bindings.
3. Add binding name:

```text
AI_LENS_LEADS
```

4. Bind it to a KV namespace.

## Optional webhook

In Cloudflare Pages:

1. Settings → Environment variables.
2. Add:

```text
LEAD_WEBHOOK_URL
```

3. Paste Airtable/Make/Zapier/CRM webhook URL.

If no KV or webhook is connected, the page still works visually, but leads are not permanently stored.

## Test

Open:

```text
https://1clic-ia.eu/
```

Enter:

- website URL
- email or WhatsApp
- consent checkbox

Then click:

```text
Run free AI LENS scan
```

# AI LENS V1.4 — Automatic Email Version

This version can send the report automatically to:

- the client email
- a blind copy to the owner email

## Upload to GitHub

Upload all files/folders:

```text
index.html
assets/ai-lens-hero-laptop.png
functions/api/send-report.js
README.md
```

## Cloudflare environment variables

In Cloudflare Pages:

```text
Pages
→ your 1clic-ia.eu project
→ Settings
→ Environment variables
```

Add:

```text
RESEND_API_KEY = your Resend API key
OWNER_EMAIL = contact@5thelement.ai
FROM_EMAIL = AI LENS <verified@yourdomain.com>
```

For first test, Resend may allow:

```text
FROM_EMAIL = AI LENS <onboarding@resend.dev>
```

For production, verify your domain in Resend and use:

```text
FROM_EMAIL = AI LENS <report@1clic-ia.eu>
```

## Verify

1. Open:
```text
https://1clic-ia.eu/api/send-report
```

Expected:
```json
{"ok":true,"endpoint":"AI LENS automatic email endpoint is live."}
```

2. Open:
```text
https://1clic-ia.eu
```

3. Run scan.

4. Enter client email.

5. Check consent.

6. Click:
```text
Send report automatically
```

Expected:
- client receives email
- OWNER_EMAIL receives BCC copy

If it fails, check:
- RESEND_API_KEY exists
- FROM_EMAIL is allowed by Resend
- Cloudflare deployment succeeded

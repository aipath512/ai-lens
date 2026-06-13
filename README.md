export async function onRequestPost(context) {
  try {
    const data = await context.request.json();

    const lead = {
      id: crypto.randomUUID(),
      created_at: data.created_at || new Date().toISOString(),
      source_site: data.source_site || "1clic-ia.eu",
      tool: data.tool || "AI LENS",
      scanned_url: data.scanned_url || "",
      email: data.email || "",
      whatsapp: data.whatsapp || "",
      consent: Boolean(data.consent),
      score: data.score || "",
      green: data.green || "",
      yellow: data.yellow || "",
      red: data.red || "",
      user_agent: data.user_agent || "",
      ip_country: context.request.headers.get("cf-ipcountry") || ""
    };

    if (!lead.consent) {
      return Response.json({ ok: false, error: "Consent is required." }, { status: 400 });
    }

    if (!lead.email && !lead.whatsapp) {
      return Response.json({ ok: false, error: "Email or WhatsApp is required." }, { status: 400 });
    }

    if (!lead.scanned_url) {
      return Response.json({ ok: false, error: "Website URL is required." }, { status: 400 });
    }

    // Option 1: Cloudflare KV storage.
    // Create KV namespace named AI_LENS_LEADS and bind it to this Pages project.
    if (context.env.AI_LENS_LEADS) {
      await context.env.AI_LENS_LEADS.put(
        `lead:${lead.created_at}:${lead.id}`,
        JSON.stringify(lead, null, 2)
      );
    }

    // Option 2: Airtable webhook or Make/Zapier webhook.
    // Add environment variable LEAD_WEBHOOK_URL in Cloudflare Pages settings.
    if (context.env.LEAD_WEBHOOK_URL) {
      await fetch(context.env.LEAD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead)
      });
    }

    return Response.json({ ok: true, lead_id: lead.id });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestGet() {
  return Response.json({ ok: true, endpoint: "AI LENS lead capture is live." });
}

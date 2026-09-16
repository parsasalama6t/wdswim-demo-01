// Visit /api/health in a browser to see why the chat isn't working.
// Never prints your key — only whether it's present and whether Anthropic accepts it.

export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  const out = {
    keyPresent: Boolean(key),
    keyLooksValid: Boolean(key && key.startsWith("sk-ant-")),
    keyLength: key ? key.length : 0,
    model: "claude-sonnet-5",
  };

  if (!key) {
    out.status = "FAIL";
    out.fix = "ANTHROPIC_API_KEY is not set. Vercel -> Settings -> Environment Variables -> add it for Production, then redeploy (env vars only apply to new deployments).";
    return res.status(200).json(out);
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: out.model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with the word ok." }],
      }),
    });

    out.anthropicStatus = r.status;
    if (r.ok) {
      out.status = "OK";
      out.fix = "Everything works. The chat should run.";
      return res.status(200).json(out);
    }

    const raw = await r.text();
    try {
      const j = JSON.parse(raw);
      out.anthropicError = j.error ? j.error.message : raw.slice(0, 300);
    } catch (_) {
      out.anthropicError = raw.slice(0, 300);
    }

    out.status = "FAIL";
    if (r.status === 401) out.fix = "The key was rejected. Create a fresh key at console.anthropic.com -> API Keys, update it in Vercel, and redeploy.";
    else if (r.status === 400) out.fix = "The request was rejected, usually an unknown model name. Check MODEL in api/chat.js against the model list at console.anthropic.com.";
    else if (r.status === 402 || /credit|balance|quota/i.test(out.anthropicError || "")) out.fix = "Out of API credit. Add credit at console.anthropic.com -> Billing. Note: Claude.ai subscription credit is separate from API credit.";
    else if (r.status === 429) out.fix = "Rate limited right now. Wait a minute and reload this page.";
    else out.fix = "See anthropicError above.";
    return res.status(200).json(out);
  } catch (e) {
    out.status = "FAIL";
    out.anthropicError = e && e.message ? e.message : "unknown";
    out.fix = "The server could not reach Anthropic at all. Check the Vercel function logs.";
    return res.status(200).json(out);
  }
}

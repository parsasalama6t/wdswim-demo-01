// Visit /api/health in a browser to see why the chat isn't working.
// Sends one real chat turn with exactly the settings the chat uses. Never prints your key.

import { askAgent, errorMessage, MODEL } from "./_agent.js";

// Reuse a passing result for a minute, so reloading this page doesn't spend a chat turn every time.
let lastOk = null;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.ANTHROPIC_API_KEY;
  const out = {
    keyPresent: Boolean(key),
    keyLooksValid: Boolean(key && key.startsWith("sk-ant-")),
    keyLength: key ? key.length : 0,
    model: MODEL,
  };

  if (!key) {
    out.status = "FAIL";
    out.fix = "ANTHROPIC_API_KEY is not set. Vercel -> Settings -> Environment Variables -> add it for Production, then redeploy (env vars only apply to new deployments).";
    return res.status(200).json(out);
  }

  if (lastOk && Date.now() - lastOk.at < 60000) return res.status(200).json(lastOk.body);

  const started = Date.now();
  try {
    const { reply } = await askAgent([{ role: "user", content: "Hi" }]);
    out.status = "OK";
    out.ms = Date.now() - started;
    out.sampleReply = reply.slice(0, 200);
    out.fix = "Everything works. The chat should run.";
    lastOk = { at: Date.now(), body: out };
    return res.status(200).json(out);
  } catch (e) {
    out.status = "FAIL";
    out.ms = Date.now() - started;
    out.anthropicStatus = e?.status;
    out.anthropicError = errorMessage(e);

    const s = e?.status;
    if (s === 401) out.fix = "The key was rejected. Create a fresh key at console.anthropic.com -> API Keys, update it in Vercel, and redeploy.";
    else if (s === 402 || /credit|balance|quota/i.test(out.anthropicError)) out.fix = "Out of API credit. Add credit at console.anthropic.com -> Billing. Note: Claude.ai subscription credit is separate from API credit.";
    else if (s === 404) out.fix = "Unknown model. Check the ANTHROPIC_MODEL environment variable in Vercel (or MODEL in api/_agent.js).";
    else if (s === 429) out.fix = "Rate limited right now. Wait a minute and reload this page.";
    else if (s >= 500) out.fix = "Anthropic is overloaded or having trouble right now. Wait a minute and reload this page.";
    else if (s) out.fix = "Anthropic rejected the request. See anthropicError above.";
    else out.fix = "No usable reply from Anthropic. See anthropicError above and the Vercel function logs.";
    return res.status(200).json(out);
  }
}

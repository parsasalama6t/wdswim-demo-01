// Serverless function: keeps your API key on the server, never in the browser.
// Works on Vercel as-is. See README for Netlify.

const MODEL = "claude-sonnet-5";
const MAX_TURNS = 40;         // stops a runaway conversation
const MAX_CHARS = 1500;       // per parent message
const DAILY_CALL_CAP = 400;   // rough spend guard across all visitors

const OUTPUT_CONTRACT = `

## Output format (strict)
Respond with ONLY a JSON object, no code fences and no text around it:
{"reply": "<the WhatsApp message to the parent>", "leads": []}
- "leads" stays empty except in the single turn where the parent confirms their summary (or asks for a person). Then add one object per child: {"parent_name":"","child_full_name":"","child_age":"","date_of_birth":"","gender":"","swim_experience":"","preferred_time_1":"","preferred_time_2":"","preferred_time_3":"","heard_about_us":"","notes":""}
- Never resubmit a lead you already submitted.
- "reply" is plain WhatsApp text only: never put code, JSON or function calls inside it.`;

let windowStart = Date.now();
let callsThisWindow = 0;

function parseAgent(raw) {
  const cleaned = String(raw).replace(/```json|```/g, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a === -1 || b === -1) return null;
  try {
    const obj = JSON.parse(cleaned.slice(a, b + 1));
    if (typeof obj.reply !== "string") return null;
    return { reply: obj.reply.trim(), leads: Array.isArray(obj.leads) ? obj.leads : [] };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });

  // Reset the spend guard every 24h
  if (Date.now() - windowStart > 86400000) { windowStart = Date.now(); callsThisWindow = 0; }
  if (++callsThisWindow > DAILY_CALL_CAP) return res.status(429).json({ error: "Daily demo limit reached" });

  const { system, turns } = req.body || {};
  if (typeof system !== "string" || !Array.isArray(turns) || !turns.length) {
    return res.status(400).json({ error: "Bad request" });
  }
  if (turns.length > MAX_TURNS) return res.status(400).json({ error: "Conversation too long" });

  const messages = turns.slice(-MAX_TURNS).map((t) => ({
    role: t.role === "assistant" ? "assistant" : "user",
    content: String(t.content || "").slice(0, MAX_CHARS),
  }));

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: system.slice(0, 20000) + OUTPUT_CONTRACT,
        messages,
      }),
    });

    if (r.status === 429) return res.status(429).json({ error: "Rate limited" });
    if (!r.ok) {
      const detail = await r.text();
      console.error("Anthropic error", r.status, detail.slice(0, 500));
      return res.status(502).json({ error: "Upstream error" });
    }

    const data = await r.json();
    const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const parsed = parseAgent(raw);
    if (!parsed) return res.status(502).json({ error: "Unreadable reply" });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(parsed);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Request failed" });
  }
}

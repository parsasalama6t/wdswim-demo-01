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
- "leads" stays empty except in the single turn where the parent confirms their summary (or asks for a person). Then add one object per child: {"kids_total":"","child_number":"","age":"","gender":"","previous_experience":"","availability_1":"","availability_2":"","availability_3":"","notes":""}
- Never resubmit a lead you already submitted.
- "reply" is plain WhatsApp text only: never put code, JSON or function calls inside it.`;

let windowStart = Date.now();
let callsThisWindow = 0;

function extractJson(raw) {
  const cleaned = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  // Walk the string tracking quotes and escapes so braces inside text don't fool us.
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return cleaned.slice(start, i + 1); }
  }
  return cleaned.slice(start); // truncated output: try to repair below
}

function repair(text) {
  // Escape raw newlines/tabs that appear inside JSON strings, and close an unterminated tail.
  let out = "", inStr = false, esc = false;
  for (const c of text) {
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr && c === "\n") { out += "\\n"; continue; }
    if (inStr && c === "\r") { continue; }
    if (inStr && c === "\t") { out += "\\t"; continue; }
    out += c;
  }
  if (inStr) out += '"';
  // Close whatever is still open, innermost first.
  const stack = []; inStr = false; esc = false;
  for (const c of out) {
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop() === "[" ? "]" : "}";
  return out;
}

function parseAgent(raw) {
  const slice = extractJson(raw);
  if (!slice) return null;
  for (const candidate of [slice, repair(slice)]) {
    try {
      const obj = JSON.parse(candidate);
      if (typeof obj.reply === "string") {
        return { reply: obj.reply.trim(), leads: Array.isArray(obj.leads) ? obj.leads : [] };
      }
    } catch (_) { /* try the next candidate */ }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel. Add it under Settings -> Environment Variables, then redeploy." });

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

  const askAnthropic = async (msgs) => {
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
        // Prefilling "{" makes the model continue a JSON object instead of chatting.
        messages: msgs.concat([{ role: "assistant", content: "{" }]),
      }),
    });
    const raw = r.ok ? await r.json() : await r.text();
    return { ok: r.ok, status: r.status, raw };
  };

  try {
    let attempt = await askAnthropic(messages);

    if (attempt.status === 429) return res.status(429).json({ error: "Rate limited" });
    if (!attempt.ok) {
      console.error("Anthropic error", attempt.status, String(attempt.raw).slice(0, 500));
      let msg = "Anthropic returned " + attempt.status;
      try { const j = JSON.parse(attempt.raw); if (j.error && j.error.message) msg = j.error.message; } catch (_) {}
      return res.status(502).json({ error: msg });
    }

    const textOf = (d) => "{" + (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");

    let parsed = parseAgent(textOf(attempt.raw));

    if (!parsed) {
      // One corrective retry before giving up.
      console.warn("Unparseable first attempt:", textOf(attempt.raw).slice(0, 300));
      const retryMsgs = messages.concat([{
        role: "user",
        content: "Your previous reply was not valid JSON. Reply again to the same message, as a single JSON object only: {\"reply\": \"...\", \"leads\": []}. Escape every newline inside strings as \\n.",
      }]);
      attempt = await askAnthropic(retryMsgs);
      if (attempt.ok) parsed = parseAgent(textOf(attempt.raw));
    }

    if (!parsed) {
      console.error("Unparseable after retry");
      return res.status(502).json({ error: "The assistant replied in an unexpected format. Send the message again." });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(parsed);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Could not reach Anthropic: " + (e && e.message ? e.message : "unknown error") });
  }
}

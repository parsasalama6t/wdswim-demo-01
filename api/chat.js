// Serverless function: keeps your API key on the server, never in the browser.
// Works on Vercel as-is. See README for Netlify.

import Anthropic from "@anthropic-ai/sdk";
import { askAgent, errorMessage } from "./_agent.js";

const MAX_TURNS = 150;            // stops a runaway conversation
const MAX_USER_CHARS = 1500;      // per parent message
const MAX_ASSISTANT_CHARS = 6000; // an assistant turn is the reply plus any leads, as JSON
const DAILY_CALL_CAP = 400;       // rough spend guard across all visitors

let windowStart = Date.now();
let callsThisWindow = 0;

const isTurn = (t) =>
  Boolean(t) && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim() !== "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel. Add it under Settings -> Environment Variables, then redeploy." });

  // Only the conversation comes from the browser; the system prompt lives in api/_agent.js.
  let turns = null;
  try { turns = (req.body || {}).turns; } catch (_) { /* malformed JSON */ }
  if (!Array.isArray(turns) || !turns.length || !turns.every(isTurn) || turns[0].role !== "user" || turns[turns.length - 1].role !== "user") {
    return res.status(400).json({ error: "Bad request" });
  }
  if (turns.length > MAX_TURNS) return res.status(400).json({ error: "This conversation is too long. Tap Start over." });

  // Reset the spend guard every 24h
  if (Date.now() - windowStart > 86400000) { windowStart = Date.now(); callsThisWindow = 0; }
  if (++callsThisWindow > DAILY_CALL_CAP) return res.status(429).json({ error: "Daily demo limit reached. Try again tomorrow." });

  const messages = turns.map((t) => ({
    role: t.role,
    content: t.content.slice(0, t.role === "assistant" ? MAX_ASSISTANT_CHARS : MAX_USER_CHARS),
  }));

  try {
    const out = await askAgent(messages);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(out);
  } catch (e) {
    console.error("Agent error", e);
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Too many messages at once. Wait a moment and try again." });
    return res.status(502).json({ error: errorMessage(e) });
  }
}

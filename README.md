# WD Swim — free trial agent demo (self-hosted)

A shareable demo of the WD Swim WhatsApp trial-booking agent. Anyone with the link
can try it; no Claude account needed. Your API key stays on the server.

**Flow:** how many kids -> per child: age (3-17), gender, previous experience ->
up to 3 availabilities inside operating hours -> confirm -> lead logged -> a
receptionist contacts the parent.

**Hours:** Mon-Fri 3:45-9 PM | Sat 9 AM-7 PM | Sun 8:45 AM-5 PM

## Deploy to Vercel (about 5 minutes)

1. Create a repo and push these files (GitHub, GitLab, whatever you use).
2. Go to vercel.com, sign in, **Add New → Project**, and import that repo.
3. Before clicking Deploy, open **Environment Variables** and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from console.anthropic.com → API Keys
4. Deploy. You get a URL like `wd-swim-demo.vercel.app`.
5. Optional: **Settings → Domains** to point your own domain at it.

No build step, no dependencies to install.

## Deploy to Netlify instead

Same idea, two changes:
- Move `api/chat.js` to `netlify/functions/chat.js`
- In `index.html`, change `fetch("/api/chat"` to `fetch("/.netlify/functions/chat"`

Then set `ANTHROPIC_API_KEY` under Site settings → Environment variables.

## If the chat says an error

Open `https://YOUR-SITE.vercel.app/api/health` in a browser. It tells you exactly
what's wrong and how to fix it, without ever printing your key. The usual causes:

- **ANTHROPIC_API_KEY not set**, or set after the last deploy. Environment variables
  only apply to *new* deployments, so redeploy after adding it.
- **Key rejected (401).** Make a fresh key at console.anthropic.com -> API Keys.
- **No API credit.** Claude.ai subscription credit is separate from API credit;
  add credit under console.anthropic.com -> Billing.

## Cost

Each full conversation runs roughly $0.08–0.12 on Claude Sonnet 5, so $5 of credit
covers about 40–60 demo runs. To stretch it further, change `MODEL` in
`api/chat.js` to `claude-haiku-4-5-20251001` — roughly half the cost, slightly
less polished replies.

`api/chat.js` caps the demo at 400 calls a day so a shared link can't quietly
drain your credit. Change `DAILY_CALL_CAP` if you need more.

## Keeping it in sync

The demo's behaviour lives in the system prompt inside `index.html`
(`PROMPT_TEMPLATE`). It mirrors the n8n agent's prompt. When the real agent
changes, update both so the demo doesn't promise something the live agent won't do.

## Notes

- The leads sheet and staff inbox in the demo are simulated. Nothing writes to the
  real Google Sheet, and everything resets on reload.
- Never commit your API key. It belongs only in the environment variable.
- If the key ever leaks, revoke it at console.anthropic.com and add a new one.

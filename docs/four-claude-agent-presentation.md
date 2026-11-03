# Four Claude Agents — presentation lab (isolated)

## Scope
This is an experimental CLI demonstration on `feature/claude-autonomous-agent-spike`. It does **not** change the existing application, Huma's frontend, the deterministic safety/workflow layer, production, or PostgreSQL. Uses a fictional SKU with recorded 8 / observed 5 and four model-driven agent runs in sequence. Agents choose tool calls; each records one handoff. The final action stage has no authority to adjust stock or forge reviewer approval.

## Run on Mac

```sh
npm ci
git fetch origin
git switch --track origin/feature/claude-autonomous-agent-spike
# In an ignored local .env, set ANTHROPIC_API_KEY and CLAUDE_MODEL (model accessible to your account).
node --env-file=.env scripts/demo-four-claude-agents.mjs
```

No separate Claude agent installation is required. Do not publish the API key, commit .env, or run the demo with real inventory. Expect four named handoffs, tool-call audit lines, an unchanged inventory quantity of 8, and `inventoryChanged: false`. Each actual run requires network access and API credits. The script has not been verified against an account's live Claude API in this PR.

## Acceptance gates
1. Four real model calls/agent runs and four structured handoffs produced; no hallucinated approvals.
2. Missing key/model fails closed.
3. Final inventory remains 8; agents have no write-capable tools.
4. No source files for the existing server, dashboard, DB migrations, Huma's frontend, or `main` are changed.

## Production issue (separate)
Production `/api/health` previously returned 503 `Application configuration unavailable.`, with startup diagnostic `configuration_invalid`. The deployed environment values have not been inspected through authorized Vercel project access, so a fix is **not verified**. Verify exact active deployment settings (without printing secrets): both database URLs are remote PostgreSQL with exactly one `sslmode=verify-full`, no forbidden TLS overrides, distinct database usernames, SUPABASE_URL and APP_ORIGIN are exact HTTPS origins without trailing slash, and SUPABASE_PUBLISHABLE_KEY is a publishable or legacy anon key. Match deploy commit/environment before any redeploy. No more speculative variable changes. Production fix and release require separate verification and approval.

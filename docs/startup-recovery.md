# Startup recovery and private diagnostics

The workspace starts hidden, inert and inside a disabled fieldset. A capture-phase
submission guard is installed before backend requests. Inventory forms never use
native HTML submission, including during configuration failure or sign-in.

A failed configuration request, network failure, malformed response or failed
initial inventory load shows a generic connection error with Retry. Retry starts
a fresh connection attempt; concurrent attempts and repeated mounting after
success are ignored. If rendering itself fails after handlers may have attached,
Retry reloads the page to avoid duplicate handlers. Authentication remains outside
the locked workspace. Only successful initialization and authenticated inventory
loading unlock it; explicit local demo mode retains its existing behavior.

Configuration and inventory requests have a ten-second timeout. A timed-out
mutation still uses the existing uncertain-result/idempotency handling; timeout
does not imply a write was cancelled at the server.

The Vercel adapter logs only `Lookout startup failed.` plus one fixed code:

| Code | Meaning |
|---|---|
| configuration_missing | A required configuration entry is absent |
| configuration_invalid | Production flags, origin/provider settings or credential separation are invalid |
| database_authentication | PostgreSQL rejected authentication (SQLSTATE 28P01 or 28000) |
| database_tls | Recognized certificate validation failure or missing certificate file |
| database_initialization | Other initialization/connection/privilege failure |

Public initialization failures remain HTTP 503 with the same generic JSON body.
Diagnostics never include exception text, causes, stacks, usernames, hosts, SQL,
passwords, tokens or environment values. Unknown error codes map to the generic
initialization category. Logger failure cannot change the public error response.

These changes improve failure behavior; they do not configure production secrets,
rotate credentials, change TLS settings, repair provider delivery or deploy code.
Retain separate restricted logins, verified CA and hostname validation, and all
existing deployment approval gates.

Run `npm test`, `npm run build`, and the existing API/PostgreSQL/adapter suites.
`startup.test.js` covers config 503/network/malformed responses, recovery, native
submission prevention, authentication gating and partial-mount recovery.
`server/startup-diagnostics.test.js` covers redaction, categories and adapter retry.

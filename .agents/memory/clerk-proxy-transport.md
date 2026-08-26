---
name: Clerk proxy transport
description: How AgarAccounting's managed Clerk proxy differs between development and production.
---

Use `VITE_CLERK_PROXY_URL` as the `ClerkProvider` proxy URL without hardcoding or environment gating it.

**Why:** The API proxy middleware is intentionally inactive for development Clerk instances, while the platform provisions the proxy URL for production. A fixed proxy path breaks development Clerk JS loading; omitting the provider prop breaks production proxy use.

**How to apply:** Preserve the canonical client wiring whenever touching Clerk configuration. Validate both a development sign-in flow and a production-style build after auth changes.
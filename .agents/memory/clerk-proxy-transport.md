---
name: Clerk proxy transport
description: How AgarAccounting's managed Clerk proxy differs between development and production.
---

Use `VITE_CLERK_PROXY_URL` for published builds, but pass no proxy URL in development when the managed secret is present in the shared environment.

**Why:** The API proxy middleware is intentionally inactive for development Clerk instances, but this workspace now exposes the production proxy secret to the development process. Passing it during preview makes Clerk request `/api/__clerk`, where the development API correctly does not proxy and returns 401.

**How to apply:** Keep the conditional production-only client value in both web artifacts, preserve the server proxy middleware for published builds, and validate both a development sign-in flow and a production-style build after auth changes.
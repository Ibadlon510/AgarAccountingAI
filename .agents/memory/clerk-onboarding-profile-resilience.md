---
name: Clerk onboarding profile resilience
description: Keep LedgerFlow onboarding independent from mutable Clerk profile writes.
---

LedgerFlow must persist the required account-owner name in its authenticated local account record before workspace configuration; it must not require a browser-side Clerk `user.update()` to succeed.

**Why:** In the published Replit-managed Clerk environment, the proxied profile endpoint can return HTTP 422 for an otherwise authenticated user. Blocking company registration on that display-profile update prevents a valid user from entering the app.

**How to apply:** Treat Clerk as the authentication and verified-email source. Populate local names from Clerk only when the local fields are absent, and preserve a name that the user saved during LedgerFlow onboarding. Keep company/workspace setup sequenced after the local profile save.
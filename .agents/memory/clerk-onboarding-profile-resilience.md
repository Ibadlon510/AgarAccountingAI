---
name: Clerk onboarding profile resilience
description: Keep AgarAccounting onboarding independent from mutable Clerk profile writes.
---

AgarAccounting must persist the required account-owner name in its authenticated local account record before workspace configuration; it must not require a browser-side Clerk `user.update()` to succeed.

When a verified Clerk identity has a new subject but its verified email already owns a local account, reuse that local account rather than creating a duplicate. Existing workspace ownership remains attached to the stable local account ID.

**Why:** Replit-managed Clerk development and production identities can differ from historical or migrated subjects. The local email is unique, so an insert under the new subject can lose its conflict and leave a valid signed-in user unable to load workspaces. Separately, the published proxied profile endpoint can return HTTP 422 for an otherwise authenticated user.

**How to apply:** Treat Clerk as the authentication and verified-email source. Link only on Clerk's verified primary email, retain the existing local ID and memberships, populate local names only when absent, and preserve a name saved during AgarAccounting onboarding. Keep company/workspace setup sequenced after the local profile save.
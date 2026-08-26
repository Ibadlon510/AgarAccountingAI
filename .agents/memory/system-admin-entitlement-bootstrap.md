---
name: System-admin entitlement bootstrap
description: The authorization boundary between initial system-admin bootstrap and explicit revocation.
---

The first system-administrator grant is an explicit authenticated browser claim, independent of how many ordinary tenant users already exist. It permanently closes bootstrap through a singleton state independent of user and entitlement rows; later reactivation is explicit.

**Why:** A shared user table can already contain many tenant users before system administration is initialized, so user count cannot identify the first administrator. Revocation must remain authoritative even after user deletion, entitlement cascade deletion, concurrent claims, or a deployment racing an admin insert.

**How to apply:** Return Clerk sign-in to the system-admin artifact, never the tenant workspace. Serialize all grant paths, create closure before entitlement, never cascade closure, and never auto-promote during ordinary sign-in. Install the admin-insert closure trigger before backfilling historical admins.
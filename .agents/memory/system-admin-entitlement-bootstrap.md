---
name: System-admin entitlement bootstrap
description: The authorization boundary between initial system-admin bootstrap and explicit revocation.
---

The first system-administrator grant permanently closes bootstrap through a singleton state independent of user and entitlement rows. Login bootstrap may grant only when it atomically creates that closure; later reactivation is explicit.

**Why:** Revocation must remain authoritative even after user deletion, entitlement cascade deletion, concurrent provisioning, or a deployment racing an admin insert. Entitlement existence alone is not durable closure.

**How to apply:** Serialize all grant paths. Install the admin-insert closure trigger before backfilling historical admins. Create closure before entitlement, never cascade closure, and gate login bootstrap on winning closure creation. Keep allowlists in secrets.
---
name: System-admin entitlement bootstrap
description: Why production system-rate administrator access is activated through a verified-email bootstrap allowlist.
---

Production system-rate administrator access may be bootstrapped from a production-only email allowlist. A matching account is granted or reactivated only after an authenticated request supplies its verified identity; normal authorization still depends on the persisted entitlement row.

**Why:** Production database access available to agents is read-only, while system administration must remain separate from ordinary workspace roles. The bootstrap creates the explicit entitlement through the application without hardcoding an individual identity in source or weakening the authorization check.

**How to apply:** Keep the allowlist production-specific and limited to intended administrators. Removing an address does not revoke an already persisted entitlement; revocation must update the entitlement status separately.
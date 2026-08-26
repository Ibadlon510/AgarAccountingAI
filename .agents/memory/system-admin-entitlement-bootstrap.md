---
name: System-admin entitlement bootstrap
description: The authorization boundary between initial system-admin bootstrap and explicit revocation.
---

An allowlisted identity may create a missing system-administrator entitlement, but authenticated access must never reactivate an existing revoked entitlement.

**Why:** Revocation must remain authoritative. A login-time upsert that resets status would let a revoked administrator regain global access merely by signing in again.

**How to apply:** Insert only when no entitlement exists and leave conflicts untouched. Reactivation requires a separate explicit administrative action. Keep allowlist values in environment secrets or deployment configuration, never tracked source.
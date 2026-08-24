---
name: Append-only audit bootstrap
description: Database-level immutability safeguards for audit trails initialized by parallel application processes.
---

Audit immutability requires database triggers that reject `UPDATE`, `DELETE`, and `TRUNCATE`, not only an application API with no mutation route.

**Why:** Row-level mutation triggers do not fire for `TRUNCATE`. Parallel integration-test workers can also contend on PostgreSQL catalog rows if each process drops and recreates the same trigger during startup.

**How to apply:** Persist the display attribution needed by the audit record itself, avoid joins to mutable identity-profile fields, and install idempotent trigger definitions under a session-scoped PostgreSQL advisory lock. Include direct mutation attempts in integration coverage.
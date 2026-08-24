---
name: Ledger integrity constraints
description: Stable database-enforcement approach for LedgerFlow client-scoped relationships.
---

Client-scoped links between statement lines, journal entries, bank accounts, and statement imports must be enforced at the database boundary. Use the idempotent integrity-trigger installer alongside ordinary foreign keys and unique indexes instead of composite foreign keys.

**Why:** The workspace schema-push tool can create a fresh composite foreign-key schema, but cannot safely reconcile dependent composite keys on repeated pushes. That makes a normal deployment fail even though the desired schema is unchanged.

**How to apply:** When adding a relationship that must not cross a LedgerFlow client boundary, enforce basic existence with a foreign key and add or extend the integrity installer’s `BEFORE INSERT OR UPDATE` validation trigger. Keep the installer in both database-push commands, and verify two consecutive schema pushes are clean.
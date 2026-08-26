---
name: Ledger integrity constraints
description: Stable database-enforcement approach for AgarAccounting client-scoped relationships.
---

Client-scoped links between statement lines, journal entries, bank accounts, and statement imports must be enforced at the database boundary. Use the idempotent integrity installer alongside ordinary foreign keys and unique indexes instead of composite foreign keys. Reconcile changed named check constraints there as well.

**Why:** The workspace schema-push tool can create a fresh schema, but it does not reliably replace changed named check constraints and cannot safely reconcile dependent composite keys on repeated pushes. A fresh test database may pass while an existing development or production database keeps the old rule.

**How to apply:** When changing a named check constraint or adding a relationship that must not cross a AgarAccounting client boundary, reconcile it idempotently in the integrity installer. Keep the installer in every database-push path, and test both a fresh database and one retaining the previous constraint.
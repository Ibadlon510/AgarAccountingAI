---
name: Journal transition evidence
description: Durable audit convention for posting and unposting journal entries.
---

Record direct human posting and unposting in the existing append-only ledger transition history, alongside bulk actions, rather than introducing a separate audit store.

**Why:** A single immutable history gives accountants one complete, client-scoped source for who changed a journal state and keeps the transaction evidence under the same protection.

**How to apply:** Any future human-controlled journal lifecycle transition should write actor, entry, linked statement line, prior status, resulting status, and timestamp inside the same database transaction. Do not let AI or background processes invoke these transitions implicitly.
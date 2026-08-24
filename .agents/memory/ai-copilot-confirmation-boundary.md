---
name: AI copilot confirmation boundary
description: LedgerFlow AI can propose recodes and account setup, but never approves or posts entries.
---

AI may explain the close, identify similar transactions, prepare batch recodes, and propose bank-account setup. Every data-changing proposal must show its scope and require an explicit user confirmation; approval and posting remain separate accountant-controlled actions.

**Why:** The product is built around human accountability for IFRS bookkeeping. Unreviewed AI changes must not affect the ledger, and posted entries must never be changed through conversational shortcuts.

**How to apply:** New AI capabilities should return structured, client-scoped proposals. Confirmed recodes may affect only still-suggested, unposted journal work; reject proposals touching approved or posted entries.
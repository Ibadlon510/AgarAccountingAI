---
name: AI copilot confirmation boundary
description: AgarAccounting AI can prepare client-scoped recodes, setup, and bulk ledger transitions, but users alone confirm changes.
---

AI may explain the close, identify similar transactions, prepare batch recodes, propose bank-account setup, and prepare bulk approvals or postings. Every data-changing proposal must show its client scope and require an explicit user confirmation; approval and posting remain separate accountant-controlled actions.

AI-chat statement uploads are proposals too. Parsing may persist a client-scoped pending import and detected currency, but it must create no statement or journal lines until a user explicitly confirms the source currency from Import history.

Bulk transitions accept only one clear eligible status at a time: approval proposals target explicitly scoped suggested entries, while posting proposals target explicitly scoped approved entries. Broad requests with unsupported qualifiers must be refused rather than widened.

**Why:** The product is built around human accountability for IFRS bookkeeping. Unreviewed AI changes must not affect the ledger, and a guessed or mixed-status bulk scope could move the wrong entries into the ledger.

**How to apply:** New AI capabilities should return structured, client-scoped proposals. For statement uploads, retain the private source and pending preview, apply the confirmed statement currency consistently to every row, and load review lines only when that same pending record is confirmed. Confirmed recodes may affect only still-suggested, unposted journal work; reject proposals touching approved or posted entries. For bulk transitions, require journal-entry and statement-line scopes to match exactly and revalidate eligibility inside the confirmation transaction.
---
name: AI import continuity and safety
description: Rules for keeping AgarAccounting imports recoverable across navigation while limiting deterministic fallback to credible bank evidence.
---

Assistant conversations and active statement imports are client-scoped. An in-flight import must retain its exact private upload identity until a matching server-side terminal trail record is available; a client switch or refresh changes the visible context, not the originating work.

**Why:** Filenames and timestamps can collide across retries or users, while a browser request can lose its response after the server completes the import.

**How to apply:** Reconcile persisted import progress using the immutable private object path (or a durable job ID), keep it after ambiguous network/server errors, and do not permit a second unresolved import for the same client.

Persist the full validated review preview as the canonical confirmation input. Background workers may prepare and save proposals, but confirmation must load exactly the reviewed rows and suggestions rather than rerunning AI; active workers must renew a lease so only abandoned work is reclaimed.

**Why:** AI output and workspace evidence can change between preview and confirmation, and a timestamp without a heartbeat cannot distinguish a crashed worker from a legitimate long analysis.

**How to apply:** Bind the preview to the client-scoped import ID, upload path, and file hash; conditionally transition only `pending_confirmation` to `completed`; heartbeat only while `analyzing`; never confirm, post, or create review lines in the background worker.

Deterministic statement parsing is an outage fallback, not a replacement for AI’s document judgment. It may import only structured, bank-provenanced documents (or a source explicitly tied to a selected bank account), and must parse debit/credit columns as directions rather than relying on numeric signs.

**Why:** General-ledger, invoice, and account-report tables can look like bank transactions and would create misleading review lines and journal proposals.

**How to apply:** Require bank-specific provenance from the document title/account-summary area (not transaction descriptions) plus transaction-table semantics before fallback rows can enter the ledger; reject ambiguous accounting documents without creating statement lines.
---
name: Bank account import identity
description: Preventing account collisions during concurrent statement imports.
---

Treat a bank account's masked last four digits as supporting evidence, never its sole identity. The import identity combines the client, normalized bank name, account name, currency, and last four digits when available.

**Why:** A client can legitimately have accounts at different banks that share the same last four digits. Merging them makes otherwise valid transactions look like duplicates and can skip review items.

**How to apply:** When matching or creating client bank accounts from statement headers, use the complete normalized account identity and enforce it consistently in concurrency-safe creation paths. For legacy lines without persisted identity, automatic reconciliation may use a unique client account for the line currency; if multiple accounts share that currency, leave the line unassigned for human review.
---
name: Filtered ledger summaries
description: Consistency rule for paged ledger list summaries and grouped rollups.
---

Filtered ledger summaries must apply the same scoped conditions to every aggregate branch, including totals, currencies, unassigned counts, and grouped bank-account rollups.

**Why:** A summary can report a correct headline count while leaking unrelated rows into secondary aggregates if each branch rebuilds only part of the filter.

**How to apply:** Build one client-scoped filter expression and reuse it across all list and summary queries; add test data outside the filter to prove every returned aggregate remains scoped.
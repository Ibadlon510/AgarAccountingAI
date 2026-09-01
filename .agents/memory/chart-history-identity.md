---
name: Chart history identity
description: Historical safety boundary for client chart account edits and retirement.
---

Once an account is referenced, keep its stable code, canonical name, statement section, current/non-current class, cash-flow category, and OCI classification immutable. Allow accountant-controlled display and tax-treatment changes, and use archive to remove the account from future classification choices.

During chart initialization, create review-required chart records for every distinct historical statement or journal account name before backfilling durable IDs. Keep a conservative report fallback for unmatched posted names so an interrupted migration cannot remove historical amounts from statements or tax estimates.

Treat known case-only legacy system names as aliases of the same stable account identity. Do not insert a second canonical row when its reserved account code already belongs to the legacy alias, and bind new system journals to the existing active row without renaming it.

**Why:** Historical journal text and compatibility snapshots resolve through the canonical account identity. Renaming, recategorizing, or failing to migrate a referenced account can silently orphan, reclassify, or omit posted history.

**How to apply:** Guard every chart mutation after idempotent client-chart initialization. Reject destructive identity or reporting-classification edits and deletion for referenced accounts; preserve archive as the non-destructive path. Test upgrades from posted text-only history with no pre-existing chart row and from known legacy aliases that already own a reserved code.
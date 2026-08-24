---
name: Usage retention accounting
description: Truthfulness rules for LedgerFlow usage and retention metrics.
---

Usage must count only evidence that is actually retained in private object storage and has not expired. Import audit metadata alone is not stored evidence. AI usage represents successful provider-backed completions, not local workflow recommendations or failed calls.

**Why:** Administrative limit and retention pages are decision-making surfaces; counting metadata or non-provider work would make their capacity and compliance statements misleading.

**How to apply:** When adding a new usage category, define the persisted resource, its completion state, and its expiry before exposing a count. Filter the metric to those conditions and keep the UI label aligned with the same semantics.
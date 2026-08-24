---
name: Exchange-rate remediation
description: How workspace rate schedule changes affect persisted transaction conversion snapshots.
---

When a workspace exchange-rate schedule is created, edited, deleted, or imported, re-resolve the affected workspace's stored functional-currency snapshots for both statement lines and linked journal entries.

**Why:** Missing-rate transactions are intentionally excluded from consolidated totals. If a later rate did not refresh their snapshots, adding the rate would not actually restore report coverage; corrected rates would also leave reports stale.

**How to apply:** Keep original source currency and amount immutable. Apply the current schedule only to the persisted functional amount, rate, effective date, and coverage status, and always scope the refresh through workspace membership.
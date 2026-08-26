---
name: Exchange-rate remediation
description: How workspace rate schedule changes affect persisted transaction conversion snapshots.
---

When a workspace or system exchange-rate schedule changes, re-resolve unposted statement lines and linked journal entries together. Posted pairs may gain genuinely missing conversion evidence, but any existing posted snapshot is immutable.

**Why:** Missing-rate transactions are intentionally excluded from consolidated totals, so later rates must restore their coverage. Posted accounting evidence must remain stable even when a catalog rate is edited or removed.

**How to apply:** Keep source currency and amount immutable. Resolve client, then firm, then system precedence; enforce both client and firm system-rate opt-outs. Refresh each statement/journal pair atomically, await remediation before mutation responses, and refresh again when an opt-out setting changes.
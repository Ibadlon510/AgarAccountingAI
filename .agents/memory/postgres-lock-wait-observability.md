---
name: PostgreSQL lock-wait observability
description: Reliable synchronization for database concurrency tests in this workspace.
---

Do not require `pg_stat_activity.state = 'active'` when detecting blocked database sessions in this workspace. Synchronize race tests with `wait_event_type = 'Lock'`, `pg_blocking_pids(pid)`, and captured backend PIDs instead.

**Why:** PostgreSQL activity tracking can be disabled in the test environment. Blocked sessions then report state as `disabled` and omit query text even though lock wait events and blocker relationships remain available.

**How to apply:** When a concurrency test must establish queue order deterministically, capture the coordinating connection's backend PID, poll lock waits for sessions blocked by that PID, and use the newly found waiter PID to follow multi-session lock chains.
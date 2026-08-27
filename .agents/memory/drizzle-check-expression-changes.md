---
name: Drizzle check expression changes
description: How to ensure changed PostgreSQL check expressions reach the development schema and publish diff.
---

When changing the allowed values or expression of a named check constraint, give the revised constraint a new name instead of changing only its expression.

**Why:** In this workspace's Drizzle toolchain, push can report success while leaving a same-named check constraint's old expression in place. The publish diff is computed from the actual development database, so it will continue to emit the stale constraint.

**How to apply:** Change the schema source, rename the constraint, run the normal development schema push, query `pg_constraint` to verify the materialized expression, and recompute the development-to-production diff before publishing.
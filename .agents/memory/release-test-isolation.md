---
name: Release test isolation
description: Reliable execution rules for LedgerFlow's API integration suite.
---

Every API release-test run must start with a fresh, dedicated test schema, and test teardown must close HTTP connections before releasing database pools.

**Why:** LedgerFlow's transition-audit records are intentionally append-only, so ordinary relational cleanup can leave records behind or fail. Retained HTTP keep-alive connections can also prevent a test process from exiting even after all assertions pass.

**How to apply:** Hold the workspace-wide API CI lock across schema reset, migrations, and tests so concurrent task validations cannot drop each other's tables. Provision only a database whose name is explicitly recognized as a test database, keep API tests serial, and close active server connections and pools during teardown.
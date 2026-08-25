---
name: Release test isolation
description: Reliable execution rules for LedgerFlow's API integration suite.
---

Every API release-test run must start with a fresh, dedicated test schema, and test teardown must close HTTP connections before releasing database pools.

**Why:** LedgerFlow's transition-audit records are intentionally append-only, so ordinary relational cleanup can leave records behind or fail. Retained HTTP keep-alive connections can also prevent a test process from exiting even after all assertions pass.

**How to apply:** Provision only a database whose name is explicitly recognized as a test database, reset its schema before migrations, and keep API tests serial. In test teardown, always close active server connections and pools; do not weaken audit immutability merely to make cleanup succeed.
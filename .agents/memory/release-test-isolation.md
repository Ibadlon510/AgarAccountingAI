---
name: Release test isolation
description: Reliable execution rules for AgarAccounting's API integration suite.
---

Every API release-test run must start with a fresh, dedicated test schema, and test teardown must close HTTP connections before releasing database pools. Runs that target the same test database must be serialized.

**Why:** AgarAccounting's transition-audit records are intentionally append-only, so ordinary relational cleanup can leave records behind or fail. Retained HTTP keep-alive connections can also prevent a test process from exiting even after all assertions pass. Concurrent validations reset the same schema and can remove tables from an otherwise passing run.

**How to apply:** Hold the workspace-wide API CI lock across schema reset, migrations, and tests so concurrent validations cannot drop each other's tables. Provision only an explicitly recognized test database, reset it before migrations, and keep tests serial. Run global singleton/bootstrap gates in their own first invocation before fixture-heavy tests, and close connections during teardown. Production and direct test mutations must retain audit immutability; only nested FK teardown cascades may be exempted in explicitly named test databases.

When a product contract removes a blocking assertion from an integration test, remove the obsolete mutation request rather than changing it to a successful mutation if later assertions depend on the record remaining in its prior state.

**Why:** A successful replacement can change draft/post state and make a later, unrelated assertion fail, obscuring the actual contract change.

**How to apply:** Preserve the surrounding setup and downstream safeguard checks; delete only the request and assertion that encode the retired block.

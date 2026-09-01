---
name: Database environment boundary
description: How to verify Replit-managed database separation after removing an external connection.
---

Do not identify a Replit database as external from its PostgreSQL host alone. After removing an external `DATABASE_URL`, verify the logical database target and compare representative data: Replit-managed development may still use a Neon-backed host, but its database name and rows are separate from production.

**Why:** The external connection and Replit-managed connection can share provider-looking hostnames, while stale UI state and old development fixtures can make the boundary appear ambiguous.

**How to apply:** Confirm the external-database warning is gone in the Database pane, check the development and production targets independently, and never restore or overwrite development data until its existing contents have been inventoried.
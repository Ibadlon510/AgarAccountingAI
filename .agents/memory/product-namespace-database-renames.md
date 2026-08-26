---
name: Product namespace database renames
description: How to preserve persistent data when a product-wide rename changes PostgreSQL table prefixes.
---

When a product rename changes persistent table prefixes, run an explicit, idempotent namespace upgrade before the normal development/post-merge schema push. Rename tables and dependent database objects in place so IDs and external references survive.

**Why:** A schema-only rename can make non-interactive development pushes create empty replacement tables, while the application still holds references to records in the legacy tables.

**How to apply:** Test the upgrade against a populated legacy-shaped schema and verify repeated runs are no-ops. Do not add startup or deploy-time production DDL; Replit production renames must be confirmed through the Publish UI.
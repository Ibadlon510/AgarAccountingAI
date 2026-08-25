---
name: Firm exchange-rate schedules
description: Explains the deliberate scope of exchange-rate schedules in LedgerFlow.
---

Exchange-rate schedules belong to the bookkeeping firm, not to individual clients. Every client managed by that firm reuses the same schedule; different firms must remain isolated.

**Why:** Bookkeepers should import and maintain a common conversion schedule once rather than duplicate it for every client.

**How to apply:** Keep schedule CRUD, imports, and conversion lookup firm-scoped. Use the active client only to determine its firm and reporting currency.
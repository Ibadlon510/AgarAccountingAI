---
name: Firm exchange-rate schedules
description: Explains the deliberate scope of exchange-rate schedules in AgarAccounting.
---

Exchange-rate schedules belong to a stable rate profile. Firm-managed companies share the accounting firm's profile; company-only ledgers use an internal company-owner profile. Never select a rate profile from the user who happened to make the request.

**Why:** Bookkeepers should maintain a common schedule once, while unrelated companies and firms must remain isolated. Actor-based lookup makes the same company produce different conversions depending on which member imports a statement.

**How to apply:** Resolve conversion lookup from the company’s persisted rate profile and reporting currency. Restrict firm-profile mutations to firm owners/admins, and refresh only companies explicitly attached to that profile.
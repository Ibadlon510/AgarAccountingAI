---
name: Report profile eligibility
description: Eligibility rules and profile-specific output for AgarAccounting statutory-style report packs.
---

Only offer a report basis configured on the client; annual packs require a December 31 period, and IFRS 18 is restricted to full IFRS periods ending in 2027 or later. Keep the selected basis and presentation profile on the immutable snapshot.

**Why:** A report can be numerically valid while still being prepared under the wrong presentation requirements, and finalized packs must remain reviewable as originally prepared.

**How to apply:** Validate eligibility server-side even when the UI filters choices. Derive checklist prompts, note narratives, and statement subtotals from the selected profile rather than changing an existing finalized snapshot.
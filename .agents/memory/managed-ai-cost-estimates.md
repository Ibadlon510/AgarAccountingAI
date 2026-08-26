---
name: Managed AI cost estimates
description: How AgarAccounting communicates AI cost states when a Replit-managed model has no locally approved price.
---

Do not calculate or display a fabricated local USD estimate for a Replit-managed model unless both provider token usage and an approved model rate are available. Show a state that distinguishes no activity from incomplete metadata, and direct managed billing users to Replit usage for the authoritative charge.

**Why:** Replit AI Integrations bills provider-priced usage against Replit credits, but a custom managed model may not have a safe local rate in AgarAccounting's model catalog. Treating missing category activity, missing metadata, and unpriced managed usage as the same "unavailable" state is misleading.

**How to apply:** Keep workspace-owned provider estimates based on persisted token usage and catalog pricing. For managed AI without a complete local estimate, explain that the charge is tracked in Replit rather than inferring a price.
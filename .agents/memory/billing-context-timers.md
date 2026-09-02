---
name: Billing context timers
description: Keep Firm and Company trial messaging scoped to the active product context.
---

Firm routes may show Firm trial status, while company routes may show only the active company's trial status. Do not pass both billing scopes to a global banner.

**Why:** Dual-mode users can have both a firm subscription and a selected company subscription; showing both on every route makes the countdown appear to belong to the wrong product.

**How to apply:** Scope shared billing banners by the current route. Introductory pricing countdowns are a separate shared pricing notice and may appear on both Firm and Company billing cards.
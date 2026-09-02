---
name: Firm practice dashboard
description: Firm-layer landing, portfolio, and agreed-vs-actual practice overview.
---

The firm dashboard is the practice home for `firm` and `both` users. It is a book-of-clients surface, not a second Close overview and not a rollup of client money.

**Why:** Currencies and reporting bases differ across clients. A firm needs attention, team, and engagement status in one place without mixing ledgers.

**How to apply:**
- Land `firm` / `both` on `/firm-dashboard` after sign-in. Company-only users stay on `/user-portal`.
- Always pass an explicit `firmId` on firm APIs. Do not default to `firms[0]` on the server.
- `GET /agaraccounting/firm-overview` is the grouped payload. Do not N+1 `/overview` from the UI.
- Portfolio click opens `/firm-clients/:id`. **Open close desk** sets the active client and goes to `/user-portal`.
- The account switcher lists only standalone companies owned by the signed-in user. Firm-linked and onboarded client books are opened from the firm client portfolio.
- An owned company remains in the account switcher until firm onboarding creates an engagement; ownership metadata must not be cleared before that transition.
- Never sum `postedAmount` across clients. Show per-client amounts and counts only.
- Dual-mode personal (`company_owned`) companies stay off the firm book unless they are engaged with that firm.
- Pending-review and missing-FX attention items and headline counts are for **active** engagements only.
- Open close desk when the firm user still has a workspace, even if ledger actuals are hidden (never-signed expiry stays a firm draft).
- Expired engagements hide ledger actuals. Agreed terms may still appear.
- Actuals: posted journal entries per calendar month; IFRS income-statement Revenue from the latest report pack when present, otherwise live statements.

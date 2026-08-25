---
name: Onboarding domain separation
description: LedgerFlow's first-run boundary between account, company, and client data.
---

First-run onboarding registers the account owner and bookkeeping company only. Client accounting details — functional currency, reporting basis, and close period — belong to the individual client-creation flow, not to company onboarding.

**Why:** A bookkeeping firm may serve multiple clients with different currencies, reporting standards, and close calendars. Asking for one client’s accounting context while registering the firm creates a misleading setup flow.

**How to apply:** Keep onboarding limited to required account identity and company identity. Require a client’s reporting details whenever a client workspace is created, and render summaries from the selected client’s saved profile rather than hardcoded defaults.
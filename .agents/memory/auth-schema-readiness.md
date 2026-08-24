---
name: Auth schema readiness
description: The LedgerFlow OIDC callback depends on auth and workspace tables being present in development.
---

Before validating LedgerFlow sign-in, ensure the development schema has been applied completely—not only the ledger data tables.

**Why:** A partially applied development schema lets the sign-in redirect start but prevents session creation in the callback, which appears to the user as a provider redirect loop.

**How to apply:** If OIDC returns repeatedly to login after callback, verify schema readiness before changing client-side authentication or provider settings.
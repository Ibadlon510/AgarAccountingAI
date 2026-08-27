---
name: Deployment package firewall failures
description: How to distinguish Replit package-fetch failures from application build errors.
---

If publishing fails during `pnpm install` with `ERR_PNPM_FETCH_403` from `package-firewall.replit.local`, treat it as a package-fetch or firewall failure before changing application code or deployment commands.

**Why:** The failure happens before artifact build commands run, and the same lockfile can publish successfully when the package is cached or the firewall permits the fetch.

**How to apply:** Confirm the lockfile is unchanged and compare with the most recent successful build. Retry publishing first; if the exact package-firewall denial repeats, provide the build ID and package URL to Replit support rather than adding registry credentials to the repository.
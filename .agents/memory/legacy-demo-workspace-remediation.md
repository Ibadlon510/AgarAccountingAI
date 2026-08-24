---
name: Legacy demo workspace remediation
description: Conservatively separating historical seeded demo workspaces from real bookkeeping work.
---

Only reroute a legacy demo workspace when it matches the complete historical signature and has no evidence of user configuration, bookkeeping activity, imports, reporting setup, shared access, or another workspace. Preserve every legacy record and create the clean workspace in the same transaction as recording which preserved workspace was remediated.

**Why:** A name or partial data match can resemble a real workspace. Recomputing a legacy status after creating a clean workspace also changes the ownership context and can misclassify accounts.

**How to apply:** Treat any changed client setting, conversion schedule, AI configuration, classification, audit evidence, imported artifact, extra member, or extra workspace as a reason to leave the account untouched. Use the recorded remediation state—not a later heuristic—to select the clean workspace by default and to show the preservation notice.
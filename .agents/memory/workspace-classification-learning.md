---
name: Workspace classification learning
description: Privacy and accounting-safety boundary for cross-client classification suggestions.
---

Workspace classification learning may share only aggregate vendor-to-account evidence within one authenticated user's workspace. It must not retain or return source client identifiers, transaction descriptions, amounts, or line identifiers.

**Why:** A useful cross-client suggestion must not reveal another client’s financial activity, and a learned suggestion must never bypass the accounting review and posting controls.

**How to apply:** Read and write learning patterns using the authenticated user scope. Return only the target account, confidence, and aggregate confirmation count. Treat learned results as proposals that require explicit confirmation; lock and revalidate unposted journal/statement records before applying a recode and recording its evidence. A draft account choice must update the statement line and linked draft journal atomically rather than remaining a browser-only preview.

Posting records the account actually used as new workspace-learning evidence, even when it differs from an earlier suggestion. Unposting must reverse that same user's aggregate confirmation so a mistaken post cannot keep teaching the wrong account; a later explicit correction may then become the current evidence. Tests that deliberately post a conflicting account must isolate any later assertion about a uniquely current learned suggestion; otherwise the competing evidence should correctly fail closed as ambiguous.
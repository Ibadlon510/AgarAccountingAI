---
name: Statement import client intent
description: Durable ownership boundary for asynchronous statement upload, preview, and confirmation flows.
---

Every selected statement file and every derived preview must retain immutable client intent from the moment the file enters the queue. A later workspace switch must block processing or confirmation rather than rebinding the document to the newly active client.

**Why:** Active-client UI state can change while queued or asynchronous work is pending. Resolving ownership from that mutable state can make a valid upload appear under the wrong workspace or process it with unintended client context.

**How to apply:** Carry client identity through queue, upload, parse, preview, confirmation, query invalidation, and user messaging. Pair application checks with database constraints that reject cross-client relationships between imports, lines, accounts, and journals.
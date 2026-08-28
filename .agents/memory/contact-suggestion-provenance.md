---
name: Contact suggestion provenance
description: How contact-history proposals remain distinguishable from explicit accountant corrections.
---

An account treatment proposed from contact history must retain a provenance marker until posting. Re-resolve that contact evidence at posting; if it is now conflicting, unsafe, or points to a different treatment, require review. An explicit accountant recode clears the automated marker and becomes the decision being posted.

**Why:** Without a durable distinction, a stale automated suggestion can be posted after its supporting history changes, while over-eager revalidation can also wrongly reject a deliberate accountant correction.

**How to apply:** Carry this boundary through single and bulk posting confirmations. Posting revalidates active client-scoped contact and chart references, but does not reinterpret an explicit accountant recode.

Confirming a temporary contact proposal records the accountant's reviewed name, alias, and type for posting, then collapses the proposal editor. The client-scoped profile is created or reused and linked atomically when the journal is posted.

**Why:** A collapsed editor and visible “Confirmed for posting” state make confirmation feel complete without creating unused contact profiles for entries that may never be posted.

**How to apply:** After confirmation, hide the editor but keep the proposed identity and “creates on posting” status visible. Materialize the contact and classification evidence only inside the later posting transaction.

Previously mapped statement narration may point to an existing contact only when the client-scoped match is unique, the contact remains active, the narration contains a usable identity, and the prior mapping was explicitly selected, accepted, or posted. Conflicting or unreviewed mappings must not auto-select a contact.

**Why:** Reusing a reviewed mapping reduces repetitive contact work, but generic narrations and unreviewed inferred matches can otherwise spread an incorrect contact across unrelated transactions.

**How to apply:** Prefer a safe existing match, let the accountant choose another active contact, and expose new-contact creation only as the final fallback. Revalidate the matched contact in the posting transaction.

Only evidence whose linked journal entry is currently Posted may support live contact-treatment suggestions or appear in live contact history. Derive the live treatment from the current posted journal sides while retaining the append-only evidence record.

**Why:** Unposting is an explicit decision to reopen the accounting treatment. Draft-inclusive evidence would let the reopened or recoded treatment continue influencing later drafts as if it remained confirmed.

**How to apply:** Filter live learning and history by current Posted status. Do not delete historical evidence when unposting, and do not use a Draft-linked record as suggestion support.

When an inline posting decision leaves a statement line unlinked, clear the proposed contact name, alias, and type together before updating the line. A partial null proposal violates the database shape constraint.

**Why:** Production posting once sent a default customer/supplier type with blank identity fields, causing the whole journal transaction to fail even though leaving the line unlinked was valid.

**How to apply:** Normalize the payload at the server boundary and mirror that behavior in the client. Cover explicit null name/alias values with a non-null type in the posting regression test.

Post-and-create is one atomic accounting action: if posting validation fails, contact creation and line/entry linking must roll back too. The UI must synchronously suppress repeated submissions and use a native disabled button.

**Why:** Committing the contact while leaving the journal draft changed “Post & create” back to “Post”; a second click then encountered mismatched contact state.

**How to apply:** Convert post-validation failures into transaction rollbacks, keep strict draft-to-post transition checks, and regression-test rapid duplicate clicks plus failed validation after contact materialization.
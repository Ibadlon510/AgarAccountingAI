---
name: Contact suggestion provenance
description: How contact-history proposals remain distinguishable from explicit accountant corrections.
---

An account treatment proposed from contact history must retain a provenance marker until approval. Re-resolve that contact evidence at approval; if it is now conflicting, unsafe, or points to a different treatment, require review. An explicit accountant recode clears the automated marker and becomes the decision being confirmed.

**Why:** Without a durable distinction, a stale automated suggestion can be approved after its supporting history changes, while over-eager revalidation can also wrongly reject a deliberate accountant correction.

**How to apply:** Carry this boundary through single and bulk confirmation flows. Posting still revalidates active client-scoped contact and chart references, but does not reinterpret already approved history.

Confirming a temporary contact proposal records the accountant's reviewed name, alias, and type for posting, then collapses the proposal editor. The client-scoped profile is created or reused and linked atomically when the journal is posted.

**Why:** A collapsed editor and visible “Confirmed for posting” state make confirmation feel complete without creating unused contact profiles for entries that may never be posted.

**How to apply:** After confirmation, hide the editor but keep the proposed identity and “creates on posting” status visible. Materialize the contact and classification evidence only inside the later posting transaction.

Previously mapped statement narration may point to an existing contact only when the client-scoped match is unique, the contact remains active, the narration contains a usable identity, and the prior mapping was explicitly selected, accepted, or posted. Conflicting or unreviewed mappings must not auto-select a contact.

**Why:** Reusing a reviewed mapping reduces repetitive contact work, but generic narrations and unreviewed inferred matches can otherwise spread an incorrect contact across unrelated transactions.

**How to apply:** Prefer a safe existing match, let the accountant choose another active contact, and expose new-contact creation only as the final fallback. Revalidate the matched contact in the posting transaction.
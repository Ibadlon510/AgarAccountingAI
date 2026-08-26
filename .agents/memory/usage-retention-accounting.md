---
name: Usage retention accounting
description: Truthfulness rules for AgarAccounting usage and retention metrics.
---

Usage must count only evidence that is actually retained in private object storage and has not expired. Import audit metadata alone is not stored evidence. AI usage represents successful provider-backed completions, not local workflow recommendations or failed calls.

**Why:** Administrative limit and retention pages are decision-making surfaces; counting metadata or non-provider work would make their capacity and compliance statements misleading.

**How to apply:** When adding a new usage category, define the persisted resource, its completion state, and its expiry before exposing a count. Filter the metric to those conditions and keep the UI label aligned with the same semantics.

For Replit-managed AI, calculate an estimate only when the selected model has an authoritative input and output rate in the approved catalog. A supported managed model alias without published token pricing must remain explicitly unavailable; it must not be presented as zero cost or inferred from another model.

**Why:** Replit AI Integrations bills managed usage from Replit credits, but its supported-model list does not necessarily publish a per-token rate for every alias. Substituting a guessed rate makes an administrative billing surface materially misleading.

**How to apply:** Store token counts at completion, keep direct-provider and Replit-managed subtotals separate, and gate each displayed estimate on priced activities from that same billing source. Add a rate only from an authoritative Replit source.
---
name: Copilot accounting result integrity
description: Safety rules for structured accounting answers produced by the AgarAccounting copilot.
---

Grounded copilot results must reuse the same posted-entry, period-boundary, and functional-currency eligibility rules as the canonical AgarAccounting report pages. Native-currency amounts must remain partitioned by currency unless supported exchange-rate evidence converts them.

**Why:** A result can carry valid record citations yet still be materially misleading if it relabels another report, includes later-period entries, or adds unlike currencies together.

**How to apply:** For every new read tool or structured result, call the canonical calculation path or mirror its eligibility rules exactly; expose incomplete exchange-rate evidence and add regression coverage for period cutoffs and mixed currencies.
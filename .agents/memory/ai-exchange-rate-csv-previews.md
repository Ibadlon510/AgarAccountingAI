---
name: AI-assisted exchange-rate CSV previews
description: Safety boundary for importing unfamiliar exchange-rate CSV layouts.
---

For nonstandard exchange-rate CSV layouts, use AI only to prepare a bounded preview after deterministic parsing cannot identify valid rates. Validate every returned date, currency, rate, and direction on the server; never allow the preview request itself to write exchange rates.

**Why:** CSV data can be ambiguous about headers and rate direction. A preview plus explicit confirmation preserves human control while still making unfamiliar exports usable.

**How to apply:** Keep standard, recognizable CSV layouts on the deterministic path. For fallback parsing, send a limited sample as untrusted data, surface mapping/warnings/sample rows in the UI, and persist only through the existing confirmed import mutation.
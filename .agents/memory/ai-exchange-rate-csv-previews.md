---
name: AI-assisted exchange-rate file previews
description: Safety boundary for importing unfamiliar exchange-rate CSV and Excel layouts.
---

For nonstandard exchange-rate files, adapt common safe variations deterministically before rejecting them: scan initial rows for headers, honor Excel cell types and serial dates, normalize unambiguous currency names to ISO codes, and use the user-selected target currency only when the file omits one. Use AI only to prepare a bounded preview after deterministic parsing cannot identify valid rates. Validate every returned date, currency, rate, and direction on the server; never allow the preview request itself to write exchange rates.

**Why:** CSV data can be ambiguous about headers and rate direction, and Excel date cells retain important format semantics. A preview plus explicit confirmation preserves human control while still making unfamiliar exports usable. Browser-side Base64 chunking must use a chunk size divisible by three; otherwise intermediate padding corrupts the workbook in transit.

**How to apply:** Keep standard and safely adaptable CSV and Excel layouts on the deterministic path. Count and explain skipped-row reasons in previews; if no row is safe, name the missing, invalid, or ambiguous field instead of returning a generic format error. For fallback parsing, send a limited sample as untrusted data, use an AI mapping to re-read the CSV server-side when the model returns no normalized rows, surface mapping/warnings/sample rows in the UI, and persist only through the existing confirmed import mutation.
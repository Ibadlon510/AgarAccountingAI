---
name: AI-assisted exchange-rate file previews
description: Safety boundary for importing unfamiliar exchange-rate CSV and Excel layouts.
---

For nonstandard exchange-rate CSV layouts, use AI only to prepare a bounded preview after deterministic parsing cannot identify valid rates. Validate every returned date, currency, rate, and direction on the server; never allow the preview request itself to write exchange rates. Delimiter detection must inspect an initial block of rows, not only the first row, because exported files can include title or metadata rows before the header. Decode Excel workbooks server-side and use their real cell types before falling back to AI mapping.

**Why:** CSV data can be ambiguous about headers and rate direction, and Excel date cells retain important format semantics. A preview plus explicit confirmation preserves human control while still making unfamiliar exports usable. Browser-side Base64 chunking must use a chunk size divisible by three; otherwise intermediate padding corrupts the workbook in transit.

**How to apply:** Keep standard, recognizable CSV and Excel layouts on the deterministic path. For fallback parsing, send a limited sample as untrusted data, use an AI mapping to re-read the CSV server-side when the model returns no normalized rows, surface mapping/warnings/sample rows in the UI, and persist only through the existing confirmed import mutation.
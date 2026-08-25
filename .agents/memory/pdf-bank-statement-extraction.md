---
name: PDF bank statement extraction
description: Safe handling for visually tabular PDFs whose extracted text does not retain ordinary CSV rows.
---

For a recognized bank-statement PDF, parse its date/narrative/reference/amount/balance layout deterministically. Support both inline and line-separated extraction layouts, use each row's printed amount, and use the running balance only to establish direction. Keep the full deterministic set rather than replacing it with a model-produced subset.

**Why:** PDF text extractors can serialize the same visual table in incompatible layouts. Model output for a long statement can also be partial, while footer balances can be mistaken for a transaction if record boundaries are not explicit.

**How to apply:** Require transaction headers plus bank provenance (such as an IBAN) before using the PDF-specific path; preserve the generic-document rejection for financial reports. Verify parser changes against real extractor output as well as compact fixtures.
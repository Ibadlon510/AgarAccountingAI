---
name: Bank register and journal reconciliation
description: Bank-register totals must be compared with normalized statement directions and the Bank / cash side of each linked journal.
---

Compare each posted statement line’s signed amount with its linked journal’s Bank / cash movement. Legacy `credit`/`debit` statement directions normalize to inflow/outflow; reversing one linked journal changes the aggregate by twice that transaction.

**Why:** A single AED 4,000 inflow was once posted as a Bank / cash outflow, producing an AED 8,000 difference while every line remained posted and the register appeared correct.

**How to apply:** Before attributing a cash difference to opening balances or conversion, run a per-line signed comparison across all posted statement lines and linked journals.
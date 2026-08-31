---
name: Remarks email identity
description: Sender and subject identity rules for statement-line remarks emails.
---

Statement-line remarks emails must show AgarAccounting AI as the verified From identity, use the current signed-in user’s verified email as Reply-to, and include the client Company Name in the subject.

**Why:** Recipients should recognize the trusted product sender while replies still reach the accountant who initiated the request, and the subject must identify the relevant company.

**How to apply:** Keep the dialog preview and provider payload aligned whenever remarks email content or delivery headers change.
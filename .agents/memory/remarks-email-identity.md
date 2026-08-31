---
name: Remarks email identity
description: Sender and subject identity rules for statement-line remarks emails.
---

Statement-line remarks emails must show AgarAccounting AI as the verified From identity, include no Reply-to identity, include the client Company Name in the subject, and end with the initiating user’s name in a bottom salutation. The secure remarks URL must appear both as a visible linked address and a clickable button.

**Why:** Recipients should recognize the trusted product sender, clearly identify the relevant company, see who initiated the request without exposing a Reply-to identity, and have both direct and button access to the secure page.

**How to apply:** Keep the dialog preview, plain-text fallback, and HTML provider payload aligned whenever remarks email content or delivery headers change.
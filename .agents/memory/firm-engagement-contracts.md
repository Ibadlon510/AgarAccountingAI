---
name: Firm engagement contracts
description: In-app engagement onboarding, signature, and five-day firm confirmation.
---

Firm/client onboarding is a contract flow, not a one-step relationship activation. First-run `CompanyOnboarding` stays account/firm identity only.

**Why:** A provisional engagement without terms, signature, or firm confirmation is not an active connection. The parties need a frozen snapshot of services, agreed transactions/month, and agreed revenue/year.

**How to apply:**
- Store contracts in `agaraccounting_engagement_contracts`, not by overloading engagements.
- Required commercial terms: positive integer transactions/month and a revenue/year amount in the client functional currency.
- Every new revenue/year amount has its own required coverage start and end dates, independent of service dates and the client's financial year. Legacy contracts may show the coverage as unspecified rather than inferring it.
- The engagement terms are between the accounting firm and the client; AgarAccounting AI is only the software workflow for review and acknowledgement.

**Why:** The product records and routes the parties' acknowledgement but is not a contracting party.

**How to apply:** Keep legal wording, PDF headings, and invitation copy firm/client-facing, and describe AgarAccounting AI only as the delivery or acknowledgement tool.
- Invitation kind is `engagement_contract`. Accepting that invite without signing returns 409.
- Client signs in-app (typed name + checkbox + server timestamp). This is an acknowledgement stored on the engagement, not a qualified e-signature.
- After sign, the signer becomes company owner. The engagement stays **not** `active` until the firm confirms.
- `confirmBy = signedAt + 5 days`. Owner/admin confirm activates the engagement. Lazy-expire on overview, sign, and confirm.
- If the firm does not confirm: expire contract + engagement and remove firm workspace memberships. The client keeps the company.
- If the client never signs: expire the invite/contract and leave the workspace as a firm draft. Resend rotates the invite token, restores `sent` / `provisional`, and emails a new link.
- Send the signer an email with the signing link. If email delivery fails, keep the contract and show a copyable link.
- A client invitation to a registered firm creates only a provisional engagement after the firm accepts. The firm must then define the engagement, the client signs, and the firm confirms before activation.
- Reject duplicate pending invitations and invitations for an already provisional or active firm/client pair; accepting a new invite must never downgrade an active engagement.
- Persist the contract PDF at send and again at sign. After confirm, serve the stored snapshot.
- Nominations and rate-profile binding stay gated on `status === "active"`.

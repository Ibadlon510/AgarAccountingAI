---
name: Firm engagement contracts
description: In-app engagement onboarding, signature, and five-day firm confirmation.
---

Firm/client onboarding is a contract flow that runs alongside an already established relationship. First-run `CompanyOnboarding` stays account/firm identity only.

**Why:** Firms need immediate working access when a client is added or a firm invitation is accepted, while still retaining a frozen snapshot of services, agreed transactions/month, and agreed revenue/year once onboarding is completed.

**How to apply:**
- Store contracts in `agaraccounting_engagement_contracts`, not by overloading engagements.
- Required commercial terms: positive integer transactions/month and a revenue/year amount in the client functional currency.
- Every new revenue/year amount has its own required coverage start and end dates, independent of service dates and the client's financial year. Legacy contracts may show the coverage as unspecified rather than inferring it.
- The engagement terms are between the accounting firm and the client; AgarAccounting AI is only the software workflow for review and acknowledgement.

**Why:** The product records and routes the parties' acknowledgement but is not a contracting party.

**How to apply:** Keep legal wording, PDF headings, and invitation copy firm/client-facing, and describe AgarAccounting AI only as the delivery or acknowledgement tool.
- Invitation kind is `engagement_contract`. Accepting that invite without signing returns 409.
- Client signs in-app (typed name + checkbox + server timestamp). This is an acknowledgement stored on the engagement, not a qualified e-signature.
- Adding a firm client or accepting a registered-firm invitation establishes an active engagement immediately; incomplete onboarding is shown as `Pending onboarding`.
- After sign, the signer becomes company owner. Firm confirmation completes the contract record but is not an access boundary.
- `confirmBy = signedAt + 5 days`. Owner/admin confirmation marks the onboarding contract confirmed. Lazy-expire on overview, sign, and confirm.
- If signing or confirmation expires, expire only the invitation/contract. Keep the active firm connection and workspace access until someone explicitly revokes the engagement.
- Resend rotates the invite token and restores the contract to `sent` without downgrading the active engagement.
- Send the signer an email with the signing link. If email delivery fails, keep the contract and show a copyable link.
- A client invitation to a registered firm creates an active engagement after the firm accepts. The firm can complete onboarding afterward.
- Reject duplicate pending invitations and invitations for an already provisional or active firm/client pair; accepting a new invite must never downgrade an active engagement.
- Persist the contract PDF at send and again at sign. After confirm, serve the stored snapshot.
- Nominations and rate-profile binding stay gated on `status === "active"`; onboarding status does not gate either.

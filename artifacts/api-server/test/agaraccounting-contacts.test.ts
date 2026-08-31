import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db");
const ownerId = `contacts-owner-${randomUUID()}`;
const memberId = `contacts-member-${randomUUID()}`;
const foreignId = `contacts-foreign-${randomUUID()}`;
let clientId = 0;
let foreignClientId = 0;

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) throw new Error("The database name must contain test.");
  return value;
}

async function request<T>(path: string, init?: RequestInit, userId = ownerId) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-test-user-id": userId, ...init?.headers },
  });
  return { response, body: await response.json() as T };
}

type Contact = {
  id: number;
  displayName: string;
  status: string;
  aliases: string[];
  mergedIntoContactId: number | null;
};
type Line = {
  id: number; contactId: number | null; contactName: string | null; accountSuggestion: string | null;
  journalAccount: string | null; accountConfirmationRequired: boolean;
  contactSuggestionStatus: string | null; contactSuggestionReason: string | null;
  supportingPatternCount: number; functionalAmount: number | null;
  proposedContactName: string | null; proposedContactType: string | null; proposedContactAlias: string | null;
  proposedContactConfidence: number | null; proposedContactSource: string | null; contactReviewDisposition: string;
  contactDecisionState: "matched" | "named_proposal" | "needs_identification" | "dismissed";
};

async function createLine(description: string, currency = "AED", amount = 100, direction = "outflow"): Promise<Line> {
  const result = await request<Line>("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId, date: "2026-09-15", description, currency, amount, direction,
    }),
  });
  assert.equal(result.response.status, 201);
  return result.body;
}

async function entryFor(lineId: number) {
  const entries = await request<Array<{
    id: number;
    statementLineId: number;
    status: string;
    lines: Array<{ account: string; debit: number; credit: number }>;
  }>>(
    `/agaraccounting/journal-entries?clientId=${clientId}`,
  );
  assert.equal(entries.response.status, 200);
  const entry = entries.body.find((candidate) => candidate.statementLineId === lineId);
  assert.ok(entry, `Expected journal entry for statement line ${lineId}.`);
  assert.equal(entry.status, "draft");
  return entry;
}

async function link(lineId: number, contactId: number) {
  return request<Line>(`/agaraccounting/statement-lines/${lineId}/contact`, {
    method: "PATCH", body: JSON.stringify({ clientId, contactId }),
  });
}

async function recode(lineId: number, accountSuggestion: string) {
  const result = await request("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({ clientId, type: "recode_lines", lineIds: [lineId], accountSuggestion, confidence: 0.9 }),
  });
  assert.equal(result.response.status, 200);
}

async function post(entryId: number) {
  return request<{ status: string }>(`/agaraccounting/journal-entries/${entryId}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  });
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  await database.db.insert(database.usersTable).values([
    { id: ownerId, email: `${ownerId}@example.test` },
    { id: memberId, email: `${memberId}@example.test` },
    { id: foreignId, email: `${foreignId}@example.test` },
  ]);
  const app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth((req) => ({ sessionClaims: { userId: req.headers["x-test-user-id"] } })),
  });
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/api`;
});
after(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  await database.pool.end();
});

test("uses client-scoped contact history without bypassing posting or chart safeguards", async () => {
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Recurring charges ${randomUUID()}`,
      legalName: "Recurring Charges LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "2026",
    }),
  });
  assert.equal(created.response.status, 201);
  clientId = created.body.id;
  await database.db.insert(database.clientWorkspacesTable).values({ clientId, userId: memberId, role: "bookkeeper" });
  const contactAccount = await request<{ id: number; accountName: string }>("/agaraccounting/accounts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      accountCode: "5965",
      accountName: "Contact office costs",
      displayName: "Contact office costs",
      statementSection: "expense",
      currentNonCurrent: "not_applicable",
      cashFlowCategory: "operating",
      taxTreatment: "ordinary_deductible",
      taxTreatmentReason: "Confirmed supplier office costs.",
    }),
  });
  assert.equal(contactAccount.response.status, 201);

  const foreign = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Foreign ${randomUUID()}`, legalName: "Foreign Test LLC", functionalCurrency: "AED", basis: "IFRS", period: "2026" }),
  }, foreignId);
  assert.equal(foreign.response.status, 201);
  foreignClientId = foreign.body.id;

  const contact = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId, displayName: "Acme Supplies", legalName: "Acme Supplies FZ-LLC", contactType: "supplier",
      aliases: ["ACME PAYMENTS", "Acme   Supplier"],
    }),
  });
  assert.equal(contact.response.status, 201);
  assert.deepEqual(contact.body.aliases.sort(), ["ACME PAYMENTS", "Acme Supplies", "Acme Supplies FZ-LLC", "Acme Supplier"].sort());

  const inlineMatchContact = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      displayName: "Inline Match Vendor",
      legalName: "Inline Match Vendor LLC",
      contactType: "supplier",
      aliases: ["INLINE MATCH VENDOR"],
    }),
  });
  assert.equal(inlineMatchContact.response.status, 201);
  const suggestedOnly = await createLine("CARD PAYMENT INLINE MATCH VENDOR INVOICE 9917");
  assert.equal(suggestedOnly.contactId, inlineMatchContact.body.id);
  const suggestedOnlyEntry = await entryFor(suggestedOnly.id);
  await database.db.update(database.statementLinesTable).set({ contactId: null }).where(
    eq(database.statementLinesTable.id, suggestedOnly.id),
  );
  await database.db.update(database.journalEntriesTable).set({ contactId: null }).where(
    eq(database.journalEntriesTable.id, suggestedOnlyEntry.id),
  );
  const [storedSuggestedOnly] = await database.db.select().from(database.statementLinesTable).where(
    eq(database.statementLinesTable.id, suggestedOnly.id),
  );
  assert.equal(storedSuggestedOnly?.contactId, null);
  const suggestedOnlyPost = await request<{ status: string }>(
    `/agaraccounting/journal-entries/${suggestedOnlyEntry.id}/post`,
    {
      method: "POST",
      body: JSON.stringify({
        clientId,
        contactId: suggestedOnly.contactId,
        accountSuggestion: contactAccount.body.accountName,
      }),
    },
  );
  assert.equal(suggestedOnlyPost.response.status, 200);
  assert.equal(suggestedOnlyPost.body.status, "posted");
  const [postedSuggestedLine] = await database.db.select().from(database.statementLinesTable).where(
    eq(database.statementLinesTable.id, suggestedOnly.id),
  );
  const [postedSuggestedEntry] = await database.db.select().from(database.journalEntriesTable).where(
    eq(database.journalEntriesTable.id, suggestedOnlyEntry.id),
  );
  assert.equal(postedSuggestedLine?.contactId, inlineMatchContact.body.id);
  assert.equal(postedSuggestedEntry?.contactId, inlineMatchContact.body.id);
  assert.equal(postedSuggestedLine?.accountSuggestion, contactAccount.body.accountName);
  assert.equal(postedSuggestedLine?.accountClassificationId, contactAccount.body.id);
  assert.equal(postedSuggestedLine?.contactSuggestionEvidenceCount, null);
  assert.equal(postedSuggestedEntry?.debitAccount, contactAccount.body.accountName);
  assert.equal(postedSuggestedEntry?.debitAccountClassificationId, contactAccount.body.id);

  const manuallySelected = await createLine("CARD PAYMENT MANUAL CONTACT SELECTION 9918");
  assert.equal(manuallySelected.contactId, null);
  const manuallySelectedEntry = await entryFor(manuallySelected.id);
  const manualContactPost = await request<{ status: string }>(
    `/agaraccounting/journal-entries/${manuallySelectedEntry.id}/post`,
    {
      method: "POST",
      body: JSON.stringify({
        clientId,
        contactId: inlineMatchContact.body.id,
        accountSuggestion: manuallySelected.accountSuggestion,
      }),
    },
  );
  assert.equal(manualContactPost.response.status, 200);
  const [postedManualLine] = await database.db.select().from(database.statementLinesTable).where(
    eq(database.statementLinesTable.id, manuallySelected.id),
  );
  const [postedManualEntry] = await database.db.select().from(database.journalEntriesTable).where(
    eq(database.journalEntriesTable.id, manuallySelectedEntry.id),
  );
  assert.equal(postedManualLine?.contactId, inlineMatchContact.body.id);
  assert.equal(postedManualEntry?.contactId, inlineMatchContact.body.id);

  const rejectedUnknownContact = await request<{ error: string }>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      displayName: "Unknown supplier",
      legalName: "Unknown supplier",
      contactType: "supplier",
      aliases: ["UNKNOWN SUPPLIER"],
    }),
  });
  assert.equal(rejectedUnknownContact.response.status, 400);
  assert.match(rejectedUnknownContact.body.error, /Generic unknown contacts are not allowed/i);
  assert.equal((await request(`/agaraccounting/contacts/${contact.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId,
      displayName: "Unknown supplier",
      legalName: "Unknown supplier",
      aliases: ["UNKNOWN SUPPLIER"],
    }),
  })).response.status, 400);
  const updated = await request<Contact>(`/agaraccounting/contacts/${contact.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, aliases: ["ACME PAYMENTS", "ACME BANK"] }),
  });
  assert.equal(updated.response.status, 200);
  assert.ok(updated.body.aliases.includes("ACME BANK"));
  const listed = await request<Contact[]>(`/agaraccounting/contacts?clientId=${clientId}`, undefined, memberId);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body[0]?.id, contact.body.id);

  const firstMappedNarration = await createLine("POS PAYMENT BLUE HARBOR STORE 1188");
  const mappedNarration = await link(firstMappedNarration.id, contact.body.id);
  assert.equal(mappedNarration.response.status, 200);
  assert.equal(mappedNarration.body.contactId, contact.body.id);
  const repeatedMappedNarration = await createLine("POS PAYMENT BLUE HARBOR STORE 7744");
  assert.equal(repeatedMappedNarration.contactId, contact.body.id);
  assert.equal(repeatedMappedNarration.contactDecisionState, "matched");

  const unidentifiedSupplier = await createLine("CARD PAYMENT 0000");
  assert.equal(unidentifiedSupplier.contactDecisionState, "needs_identification");
  assert.equal(unidentifiedSupplier.contactSuggestionStatus, "needs_identification");
  assert.equal(unidentifiedSupplier.proposedContactName, null);
  assert.equal(unidentifiedSupplier.proposedContactAlias, null);
  assert.match(unidentifiedSupplier.proposedContactSource ?? "", /^$/);
  const unidentifiedSupplierResponse = await request<Line[]>(
    `/agaraccounting/statement-lines?clientId=${clientId}`,
  );
  const unidentifiedSupplierFromList = unidentifiedSupplierResponse.body.find((line) => line.id === unidentifiedSupplier.id);
  assert.equal(unidentifiedSupplierFromList?.contactDecisionState, "needs_identification");
  assert.match(unidentifiedSupplierFromList?.contactSuggestionStatus ?? "", /needs_identification/);
  // Posting no longer requires supplier/customer identification up front: an
  // entirely unidentified line posts through as unlinked instead of blocking.
  const unidentifiedEntry = await entryFor(unidentifiedSupplier.id);
  const unidentifiedPost = await post(unidentifiedEntry.id);
  assert.equal(unidentifiedPost.response.status, 200);
  const postedUnidentified = (await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`))
    .body.find((line) => line.id === unidentifiedSupplier.id);
  assert.equal(postedUnidentified?.contactId, null);

  // A generic "Unknown supplier" identity is still rejected, and a real but
  // unconfirmed proposal still can't be silently posted as that contact —
  // only an explicitly accepted, non-generic identity creates one on posting.
  const proposalLine = await createLine("CARD PAYMENT 1111");
  const rejectedGenericIdentity = await request<{ error: string }>(`/agaraccounting/statement-lines/${proposalLine.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId,
      contactId: null,
      proposedContactName: "Unknown supplier",
      proposedContactAlias: "UNKNOWN SUPPLIER",
      proposedContactType: "supplier",
      contactReviewDisposition: "accepted",
    }),
  });
  assert.equal(rejectedGenericIdentity.response.status, 400);
  assert.match(rejectedGenericIdentity.body.error, /real, non-generic name/i);
  const unconfirmedSupplier = await request<Line>(`/agaraccounting/statement-lines/${proposalLine.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId,
      contactId: null,
      proposedContactName: "Real Supplies",
      proposedContactAlias: "REAL SUPPLIES",
      proposedContactType: "supplier",
      contactReviewDisposition: "pending",
    }),
  });
  assert.equal(unconfirmedSupplier.response.status, 200);
  const proposalEntry = await entryFor(proposalLine.id);
  assert.equal((await post(proposalEntry.id)).response.status, 409);
  const identifiedSupplier = await request<Line>(`/agaraccounting/statement-lines/${proposalLine.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId,
      contactId: null,
      proposedContactName: "Real Supplies",
      proposedContactAlias: "REAL SUPPLIES",
      proposedContactType: "supplier",
      contactReviewDisposition: "accepted",
    }),
  });
  assert.equal(identifiedSupplier.response.status, 200);
  assert.equal(identifiedSupplier.body.contactDecisionState, "named_proposal");
  assert.equal((await post(proposalEntry.id)).response.status, 200);
  const contactsAfterIdentification = await request<Contact[]>(`/agaraccounting/contacts?clientId=${clientId}`);
  assert.ok(contactsAfterIdentification.body.some((item) => item.displayName === "Real Supplies"));
  assert.equal(
    contactsAfterIdentification.body.some((item) => /^(unknown|unnamed|card|supplier)$/i.test(item.displayName.trim())),
    false,
  );

  const unidentifiedCustomer = await createLine("TRANSFER 98765", "AED", 150, "inflow");
  assert.equal(unidentifiedCustomer.contactDecisionState, "needs_identification");
  assert.match(
    (await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`)).body
      .find((line) => line.id === unidentifiedCustomer.id)?.proposedContactName ?? "",
    /^$/,
  );
  const dismissedCustomer = await request<Line>(`/agaraccounting/statement-lines/${unidentifiedCustomer.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: null, contactReviewDisposition: "dismissed" }),
  });
  assert.equal(dismissedCustomer.response.status, 200);
  assert.equal(dismissedCustomer.body.contactDecisionState, "dismissed");
  const unidentifiedCustomerEntry = await entryFor(unidentifiedCustomer.id);
  const postedCustomer = await post(unidentifiedCustomerEntry.id);
  assert.equal(postedCustomer.response.status, 200);
  assert.equal(postedCustomer.body.status, "posted");
  const unpostedCustomer = await request<{ status: string }>(
    `/agaraccounting/journal-entries/${unidentifiedCustomerEntry.id}/unpost`,
    { method: "POST", body: JSON.stringify({ clientId }) },
  );
  assert.equal(unpostedCustomer.response.status, 200);
  assert.equal(unpostedCustomer.body.status, "draft");
  assert.equal((await post(unidentifiedCustomerEntry.id)).response.status, 200);

  const doubleClickLine = await createLine("CARD PAYMENT RAPID CLICK SUPPLIES INVOICE 4401");
  const doubleClickEntry = await entryFor(doubleClickLine.id);
  const doubleClickPayload = {
    clientId,
    contactId: null,
    proposedContactName: "Rapid Click Supplies",
    proposedContactAlias: "RAPID CLICK SUPPLIES",
    proposedContactType: "supplier",
  };
  const duplicatePosts = await Promise.all([
    request<{ status: string }>(`/agaraccounting/journal-entries/${doubleClickEntry.id}/post`, {
      method: "POST",
      body: JSON.stringify(doubleClickPayload),
    }),
    request<{ status: string }>(`/agaraccounting/journal-entries/${doubleClickEntry.id}/post`, {
      method: "POST",
      body: JSON.stringify(doubleClickPayload),
    }),
  ]);
  assert.deepEqual(duplicatePosts.map((result) => result.response.status).sort(), [200, 409]);
  const rapidClickContacts = (await request<Contact[]>(`/agaraccounting/contacts?clientId=${clientId}`)).body
    .filter((contact) => contact.displayName === "Rapid Click Supplies");
  assert.equal(rapidClickContacts.length, 1);

  const rollbackLine = await createLine("CARD PAYMENT ROLLBACK SUPPLIES INVOICE 5501");
  const rollbackEntry = await entryFor(rollbackLine.id);
  const rollbackAccount = rollbackEntry.lines.find((item) => item.debit > 0)?.account;
  assert.ok(rollbackAccount);
  await database.db.update(database.accountClassificationsTable).set({ isActive: false }).where(and(
    eq(database.accountClassificationsTable.clientId, clientId),
    eq(database.accountClassificationsTable.accountName, rollbackAccount),
  ));
  try {
    const rejectedPost = await request<{ error: string }>(`/agaraccounting/journal-entries/${rollbackEntry.id}/post`, {
      method: "POST",
      body: JSON.stringify({
        clientId,
        contactId: null,
        proposedContactName: "Rollback Supplies",
        proposedContactAlias: "ROLLBACK SUPPLIES",
        proposedContactType: "supplier",
      }),
    });
    assert.equal(rejectedPost.response.status, 409);
    assert.match(rejectedPost.body.error, /account is no longer active/i);
    const [storedRollbackLine] = await database.db.select().from(database.statementLinesTable)
      .where(eq(database.statementLinesTable.id, rollbackLine.id));
    assert.equal(storedRollbackLine?.contactId, null);
    assert.equal(storedRollbackLine?.contactReviewDisposition, "pending");
    const rollbackContacts = (await request<Contact[]>(`/agaraccounting/contacts?clientId=${clientId}`)).body
      .filter((contact) => contact.displayName === "Rollback Supplies");
    assert.equal(rollbackContacts.length, 0);
  } finally {
    await database.db.update(database.accountClassificationsTable).set({ isActive: true }).where(and(
      eq(database.accountClassificationsTable.clientId, clientId),
      eq(database.accountClassificationsTable.accountName, rollbackAccount),
    ));
  }

  const blankProposalLine = await createLine("ACCT TO ACCT TRANSFER 01910198067", "AED", 36500, "inflow");
  const blankProposalEntry = await entryFor(blankProposalLine.id);
  const blankProposalPost = await request<{ status: string }>(`/agaraccounting/journal-entries/${blankProposalEntry.id}/post`, {
    method: "POST",
    body: JSON.stringify({
      clientId,
      contactId: null,
      proposedContactName: null,
      proposedContactAlias: null,
      proposedContactType: "customer",
    }),
  });
  assert.equal(blankProposalPost.response.status, 200);
  assert.equal(blankProposalPost.body.status, "posted");

  const legacyLine = await createLine("LEGACY CONTACT NAME");
  await database.db.update(database.statementLinesTable).set({
    description: "CARD PAYMENT 12345",
    proposedContactName: null,
    proposedContactType: null,
    proposedContactAlias: null,
    proposedContactConfidence: null,
    proposedContactSource: null,
    contactReviewDisposition: "pending",
  }).where(eq(database.statementLinesTable.id, legacyLine.id));
  const legacyFromList = (await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`)).body
    .find((line) => line.id === legacyLine.id);
  assert.equal(legacyFromList?.contactDecisionState, "needs_identification");
  assert.equal(legacyFromList?.contactSuggestionStatus, "needs_identification");

  const temporary = await createLine("CARD PAYMENT NOVA OFFICE SUPPLY INV 9001");
  assert.equal(temporary.contactId, null);
  assert.equal(temporary.contactDecisionState, "named_proposal");
  assert.equal(temporary.contactSuggestionStatus, "temporary_proposal");
  assert.equal(temporary.proposedContactType, "supplier");
  assert.equal(temporary.proposedContactSource, "heuristic_description");
  assert.ok(temporary.proposedContactName);
  assert.ok(temporary.proposedContactAlias);

  const reportedNarration = await createLine("Visa Purchase Circle Espergerde Dkk Susanne Chris Aed");
  assert.equal(reportedNarration.contactDecisionState, "named_proposal");
  assert.equal(reportedNarration.contactSuggestionStatus, "temporary_proposal");
  assert.equal(reportedNarration.proposedContactName, "Circle Espergerde");
  assert.equal(reportedNarration.proposedContactAlias, "Circle Espergerde");
  assert.equal(reportedNarration.proposedContactSource, "heuristic_description");
  assert.doesNotMatch(reportedNarration.proposedContactName ?? "", /visa|purchase|dkk|susanne|chris|aed/i);

  const clearCompany = await createLine("MASTERCARD PURCHASE NORTHSTAR INDUSTRIAL SERVICES USD REF 8841");
  assert.equal(clearCompany.proposedContactName, "Northstar Industrial Services");
  assert.equal(clearCompany.contactDecisionState, "named_proposal");

  const ambiguousPerson = await createLine("JOHN SMITH TRANSFER");
  assert.equal(ambiguousPerson.contactDecisionState, "needs_identification");
  assert.equal(ambiguousPerson.proposedContactName, null);
  assert.equal(ambiguousPerson.proposedContactAlias, null);

  const pendingTemporaryEntry = await entryFor(temporary.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${pendingTemporaryEntry.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })).response.status, 409);
  assert.equal((await request(`/agaraccounting/statement-lines/${temporary.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: contact.body.id, contactReviewDisposition: "dismissed" }),
  })).response.status, 400);
  assert.equal((await request(`/agaraccounting/statement-lines/${temporary.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: null, contactReviewDisposition: "replaced" }),
  })).response.status, 400);
  const replacementCandidate = await createLine("CARD PAYMENT REPLACE THIS PROPOSAL");
  const replacedProposal = await request<Line>(`/agaraccounting/statement-lines/${replacementCandidate.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: contact.body.id, contactReviewDisposition: "replaced" }),
  });
  assert.equal(replacedProposal.response.status, 200);
  assert.equal(replacedProposal.body.contactId, contact.body.id);
  assert.equal(replacedProposal.body.proposedContactName, null);
  assert.equal(replacedProposal.body.proposedContactAlias, null);
  assert.equal(replacedProposal.body.proposedContactType, null);
  const editedTemporary = await request<Line>(`/agaraccounting/statement-lines/${temporary.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId,
      contactId: null,
      proposedContactName: "Nova Office Supply",
      proposedContactAlias: "NOVA OFFICE SUPPLY",
      proposedContactType: "supplier",
      contactReviewDisposition: "accepted",
    }),
  });

  assert.equal(editedTemporary.response.status, 200);
  assert.equal(editedTemporary.body.contactReviewDisposition, "accepted");
  const contactsBeforePost = await request<Contact[]>(`/agaraccounting/contacts?clientId=${clientId}`);
  const temporaryEntry = await entryFor(temporary.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${temporaryEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);
  const contactsAfterPost = await request<Contact[]>(`/agaraccounting/contacts?clientId=${clientId}`);
  assert.equal(contactsAfterPost.body.length, contactsBeforePost.body.length + 1);
  assert.ok(contactsAfterPost.body.some((item) => item.displayName === "Nova Office Supply"));
  const materialized = contactsAfterPost.body.find((item) => item.displayName === "Nova Office Supply");
  assert.ok(materialized);
  assert.ok(materialized.aliases.includes("NOVA OFFICE SUPPLY"));
  const [materializedLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, temporary.id));
  const [materializedEntry] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.id, temporaryEntry.id));
  assert.equal(materializedLine?.contactId, materialized.id);
  assert.equal(materializedLine?.proposedContactName, null);
  assert.equal(materializedLine?.proposedContactAlias, null);
  assert.equal(materializedEntry?.contactId, materialized.id);
  assert.equal(materializedEntry?.status, "posted");
  assert.equal((await database.db.select().from(database.contactClassificationEvidenceTable)
    .where(eq(database.contactClassificationEvidenceTable.statementLineId, temporary.id))).length, 1);
  const reusedTemporary = await createLine("NOVA OFFICE SUPPLY MONTHLY ORDER");
  assert.equal(reusedTemporary.contactId, materialized.id);

  const dismissed = await createLine("CARD PAYMENT OPT OUT LABS");
  const dismissedReview = await request<Line>(`/agaraccounting/statement-lines/${dismissed.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: null, contactReviewDisposition: "dismissed" }),
  });
  assert.equal(dismissedReview.response.status, 200);
  assert.equal(dismissedReview.body.contactReviewDisposition, "dismissed");
  assert.equal(dismissedReview.body.contactDecisionState, "dismissed");
  const dismissedEntry = await entryFor(dismissed.id);
  assert.equal((await post(dismissedEntry.id)).response.status, 200);
  const [postedDismissed] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, dismissed.id));
  assert.equal(postedDismissed?.contactId, null);

  const concurrentLines = await Promise.all([
    createLine("CARD PAYMENT PARALLEL VENDOR INVOICE A"),
    createLine("CARD PAYMENT PARALLEL VENDOR INVOICE B"),
  ]);
  for (const concurrentLine of concurrentLines) {
    const reviewed = await request<Line>(`/agaraccounting/statement-lines/${concurrentLine.id}/contact`, {
      method: "PATCH",
      body: JSON.stringify({
        clientId,
        contactId: null,
        proposedContactName: "Parallel Vendor",
        proposedContactAlias: "PARALLEL VENDOR",
        proposedContactType: "supplier",
        contactReviewDisposition: "accepted",
      }),
    });
    assert.equal(reviewed.response.status, 200);
  }
  const concurrentEntries = await Promise.all(concurrentLines.map(async (line) => entryFor(line.id)));
  const concurrentPosts = await Promise.all(concurrentEntries.map((entry) => post(entry.id)));
  assert.deepEqual(concurrentPosts.map((result) => result.response.status), [200, 200]);
  const parallelContacts = (await request<Contact[]>(`/agaraccounting/contacts?clientId=${clientId}`)).body
    .filter((item) => item.aliases.includes("PARALLEL VENDOR"));
  assert.equal(parallelContacts.length, 1);
  const concurrentPostedLines = await database.db.select().from(database.statementLinesTable);
  assert.deepEqual(
    new Set(concurrentPostedLines.filter((line) => concurrentLines.some((candidate) => candidate.id === line.id)).map((line) => line.contactId)),
    new Set([parallelContacts[0].id]),
  );

  const bulkProposalLines = await Promise.all([
    createLine("CARD PAYMENT BULK ALPHA SERVICES"),
    createLine("CARD PAYMENT BULK BETA SERVICES"),
  ]);
  const bulkProposalEntries = await Promise.all(bulkProposalLines.map(async (line) => entryFor(line.id)));

  const pendingBulkPost = await request<{ error: string }>("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "bulk_post_entries",
      entryIds: bulkProposalEntries.map((entry) => entry.id),
      statementLineIds: bulkProposalLines.map((line) => line.id),
    }),
  });
  assert.equal(pendingBulkPost.response.status, 409);
  for (const line of bulkProposalLines) {
    const accepted = await request<Line>(`/agaraccounting/statement-lines/${line.id}/contact`, {
      method: "PATCH",
      body: JSON.stringify({
        clientId,
        contactId: null,
        proposedContactName: line.proposedContactName,
        proposedContactAlias: line.proposedContactAlias,
        proposedContactType: line.proposedContactType,
        contactReviewDisposition: "accepted",
      }),
    });
    assert.equal(accepted.response.status, 200);
  }
  const bulkPost = await request<{ entryCount: number; lineCount: number }>("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "bulk_post_entries",
      entryIds: bulkProposalEntries.map((entry) => entry.id),
      statementLineIds: bulkProposalLines.map((line) => line.id),
    }),
  });
  assert.equal(bulkPost.response.status, 200);
  assert.equal(bulkPost.body.entryCount, 2);
  assert.equal(bulkPost.body.lineCount, 2);
  const bulkMaterialized = await database.db.select().from(database.statementLinesTable);
  assert.ok(bulkProposalLines.every((line) => {
    const postedLine = bulkMaterialized.find((candidate) => candidate.id === line.id);
    return postedLine?.status === "posted" && postedLine.contactId != null;
  }));

  const first = await createLine("CARD PAYMENT ACME BANK INV 1001");
  assert.equal(first.contactId, contact.body.id);
  assert.equal(first.contactDecisionState, "matched");
  assert.equal(first.contactSuggestionStatus, "no_history");
  const firstEntry = await entryFor(first.id);
  const correction = await link(first.id, contact.body.id);
  assert.equal(correction.response.status, 200);
  await recode(first.id, contactAccount.body.accountName);
  assert.equal((await request(`/agaraccounting/journal-entries/${firstEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);

  const evidence = await database.db.select().from(database.contactClassificationEvidenceTable)
    .where(eq(database.contactClassificationEvidenceTable.statementLineId, first.id));
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.accountSuggestion, contactAccount.body.accountName);
  assert.equal(evidence[0]?.entryStatus, "posted");
  assert.equal((await link(first.id, contact.body.id)).response.status, 409);

  const weak = await createLine("ACME BANK SEPTEMBER");
  assert.equal(weak.contactDecisionState, "matched");
  assert.equal(weak.contactSuggestionStatus, "weak");
  assert.equal(weak.accountSuggestion, contactAccount.body.accountName);
  assert.equal(weak.supportingPatternCount, 1);
  const weakEntry = await entryFor(weak.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${weakEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);

  // A deterministic client-scoped rate makes the EUR history posting valid.
  const rate = await request("/agaraccounting/exchange-rates?clientId=" + clientId, {
    method: "POST",
    body: JSON.stringify({ sourceCurrency: "EUR", functionalCurrency: "AED", effectiveDate: "2026-09-01", rate: 4 }),
  });
  assert.equal(rate.response.status, 201);
  const supported = await createLine("ACME BANK EUR SETTLEMENT", "EUR", 50);
  assert.equal(supported.contactSuggestionStatus, "supported");
  assert.equal(supported.accountSuggestion, contactAccount.body.accountName);
  assert.equal(supported.functionalAmount, 200);
  const supportedEntry = await entryFor(supported.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${supportedEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);

  const history = await request<{ history: Array<{ currency: string; status: string }>; treatmentSummary: Array<{ accountTreatment: string; count: number; currencies: string[] }> }>(
    `/agaraccounting/clients/${clientId}/contacts/${contact.body.id}/history`,
  );
  assert.equal(history.response.status, 200);
  assert.deepEqual(history.body.treatmentSummary, [{ accountTreatment: contactAccount.body.accountName, count: 3, currencies: ["AED", "EUR"] }]);
  assert.deepEqual(new Set(history.body.history.map((row) => row.status)), new Set(["posted"]));

  const reopenedAccount = await request<{ accountName: string }>("/agaraccounting/accounts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      accountCode: "5966",
      accountName: "Reopened contact treatment",
      displayName: "Reopened contact treatment",
      statementSection: "expense",
      currentNonCurrent: "not_applicable",
      cashFlowCategory: "operating",
      taxTreatment: "ordinary_deductible",
      taxTreatmentReason: "Explicit treatment selected after reopening a posted entry.",
    }),
  });
  assert.equal(reopenedAccount.response.status, 201);
  assert.equal((await request(`/agaraccounting/journal-entries/${supportedEntry.id}/unpost`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);
  await recode(supported.id, reopenedAccount.body.accountName);
  const afterReopen = await createLine("ACME BANK AFTER REOPEN");
  assert.equal(afterReopen.contactSuggestionStatus, "supported");
  assert.equal(afterReopen.accountSuggestion, contactAccount.body.accountName);
  assert.equal(afterReopen.supportingPatternCount, 2);
  const historyAfterReopen = await request<{ history: Array<{ statementLineId: number }>; treatmentSummary: Array<{ accountTreatment: string; count: number }> }>(
    `/agaraccounting/clients/${clientId}/contacts/${contact.body.id}/history`,
  );
  assert.equal(historyAfterReopen.response.status, 200);
  assert.equal(historyAfterReopen.body.history.some((row) => row.statementLineId === supported.id), false);
  assert.deepEqual(historyAfterReopen.body.treatmentSummary, [{
    accountTreatment: contactAccount.body.accountName,
    count: 2,
    currencies: ["AED"],
  }]);

  assert.equal((await request(`/agaraccounting/accounts/${contactAccount.body.id}/archive`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);
  assert.equal((await request(`/agaraccounting/journal-entries/${firstEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 409);
  const inactiveTreatment = await createLine("ACME BANK AFTER ARCHIVE");
  assert.equal(inactiveTreatment.contactSuggestionStatus, "no_safe_treatment");
  assert.notEqual(inactiveTreatment.accountSuggestion, contactAccount.body.accountName);

  const conflictContact = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId, displayName: "Conflict Vendor", legalName: "Conflict Vendor LLC", contactType: "supplier",
      aliases: ["CONFLICT VENDOR"],
    }),
  });
  assert.equal(conflictContact.response.status, 201);
  const conflictSeed = await createLine("CONFLICT VENDOR SOFTWARE");
  assert.equal(conflictSeed.contactId, conflictContact.body.id);
  await recode(conflictSeed.id, "Software & subscriptions");
  assert.equal((await post((await entryFor(conflictSeed.id)).id)).response.status, 200);
  const conflictCorrection = await createLine("CONFLICT VENDOR COMMUNICATIONS");
  assert.equal(conflictCorrection.contactSuggestionStatus, "weak");
  await recode(conflictCorrection.id, "Communication expenses");
  assert.equal((await post((await entryFor(conflictCorrection.id)).id)).response.status, 200);
  const conflicting = await createLine("CONFLICT VENDOR FINAL CHECK");
  assert.equal(conflicting.contactDecisionState, "matched");
  assert.equal(conflicting.contactSuggestionStatus, "conflicting");
  assert.notEqual(conflicting.accountSuggestion, "Software & subscriptions");
  assert.notEqual(conflicting.accountSuggestion, "Communication expenses");

  const staleContact = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId, displayName: "Stale Vendor", legalName: "Stale Vendor LLC", contactType: "supplier",
      aliases: ["STALE VENDOR"],
    }),
  });
  const staleSeed = await createLine("STALE VENDOR SOFTWARE");
  await recode(staleSeed.id, "Software & subscriptions");
  assert.equal((await post((await entryFor(staleSeed.id)).id)).response.status, 200);
  const staleProposal = await createLine("STALE VENDOR PENDING");
  assert.equal(staleProposal.contactSuggestionStatus, "weak");
  const changedEvidence = await createLine("STALE VENDOR PHONE");
  await recode(changedEvidence.id, "Communication expenses");
  assert.equal((await post((await entryFor(changedEvidence.id)).id)).response.status, 200);
  const staleProposalEntry = await entryFor(staleProposal.id);
  await recode(staleProposal.id, "Software & subscriptions");
  assert.equal((await request<Contact>(`/agaraccounting/contacts/${staleContact.body.id}`, {
    method: "PATCH", body: JSON.stringify({ clientId, status: "archived" }),
  })).response.status, 200);
  assert.equal((await request(`/agaraccounting/journal-entries/${staleProposalEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 409);

  const archived = await request<Contact>(`/agaraccounting/contacts/${contact.body.id}`, {
    method: "PATCH", body: JSON.stringify({ clientId, status: "archived" }),
  });
  assert.equal(archived.response.status, 200);
  const noMatch = await createLine("ACME BANK AFTER CONTACT ARCHIVE");
  assert.equal(noMatch.contactId, null);
  assert.equal(noMatch.contactSuggestionStatus, "temporary_proposal");

  const survivor = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId, displayName: "Merge Vendor", legalName: "Merge Vendor Trading LLC", contactType: "supplier",
      aliases: ["MERGE VENDOR KEEP"],
    }),
  });
  const duplicate = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId, displayName: "Merge Vendor Duplicate", legalName: "Merge Vendor Duplicate LLC", contactType: "supplier",
      aliases: ["MERGE VENDOR SOURCE"],
    }),
  });
  assert.equal(survivor.response.status, 201);
  assert.equal(duplicate.response.status, 201);
  const confirmedMergeLine = await createLine("MERGE VENDOR SOURCE SOFTWARE");
  assert.equal(confirmedMergeLine.contactId, duplicate.body.id);
  await recode(confirmedMergeLine.id, "Software & subscriptions");
  const confirmedMergeEntry = await entryFor(confirmedMergeLine.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${confirmedMergeEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);
  const reviewMergeLine = await createLine("MERGE VENDOR SOURCE PENDING");
  const reviewMergeEntry = await entryFor(reviewMergeLine.id);
  assert.equal(reviewMergeLine.contactId, duplicate.body.id);
  assert.equal(reviewMergeEntry.status, "draft");

  const previewPath = "/agaraccounting/contacts/merge/preview";
  const mergeInput = {
    clientId,
    survivingContactId: survivor.body.id,
    mergedContactId: duplicate.body.id,
  };
  assert.equal((await request(previewPath, {
    method: "POST", body: JSON.stringify(mergeInput),
  }, memberId)).response.status, 403);
  const preview = await request<{
    canMerge: boolean;
    conflicts: unknown[];
    counts: { aliases: number; statementLines: number; journalEntries: number; evidenceRecords: number };
  }>(previewPath, { method: "POST", body: JSON.stringify(mergeInput) });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.canMerge, true);
  assert.deepEqual(preview.body.conflicts, []);
  assert.equal(preview.body.counts.statementLines, 2);
  assert.equal(preview.body.counts.journalEntries, 2);
  assert.equal(preview.body.counts.evidenceRecords, 1);
  assert.ok(preview.body.counts.aliases >= 3);

  const foreignContact = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId: foreignClientId, displayName: "Foreign Merge Vendor", legalName: "Foreign Merge Vendor LLC",
      contactType: "supplier", aliases: ["FOREIGN MERGE VENDOR"],
    }),
  }, foreignId);
  assert.equal(foreignContact.response.status, 201);
  assert.equal((await request("/agaraccounting/contacts/merge", {
    method: "POST",
    body: JSON.stringify({ ...mergeInput, mergedContactId: foreignContact.body.id }),
  })).response.status, 404);

  const merged = await request<{
    auditId: number;
    survivingContact: Contact;
    mergedContact: Contact;
    statementLineIds: number[];
    journalEntryIds: number[];
    evidenceIds: number[];
  }>("/agaraccounting/contacts/merge", {
    method: "POST", body: JSON.stringify(mergeInput),
  });
  assert.equal(merged.response.status, 200);
  assert.equal(merged.body.survivingContact.id, survivor.body.id);
  assert.equal(merged.body.mergedContact.status, "archived");
  assert.equal(merged.body.mergedContact.mergedIntoContactId, survivor.body.id);
  assert.deepEqual(new Set(merged.body.statementLineIds), new Set([confirmedMergeLine.id, reviewMergeLine.id]));
  assert.deepEqual(new Set(merged.body.journalEntryIds), new Set([confirmedMergeEntry.id, reviewMergeEntry.id]));
  assert.equal(merged.body.evidenceIds.length, 1);

  const mergedLines = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.contactId, survivor.body.id));
  assert.ok(mergedLines.some((line) => line.id === confirmedMergeLine.id && line.status === "posted"));
  assert.ok(mergedLines.some((line) => line.id === reviewMergeLine.id && line.status === "draft"));
  const mergedEntries = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.contactId, survivor.body.id));
  assert.ok(mergedEntries.some((entry) =>
    entry.id === confirmedMergeEntry.id
    && entry.status === "posted"
    && entry.debitAccount === "Software & subscriptions",
  ));
  assert.ok(mergedEntries.some((entry) => entry.id === reviewMergeEntry.id && entry.status === "draft"));
  const mergedEvidence = await database.db.select().from(database.contactClassificationEvidenceTable)
    .where(eq(database.contactClassificationEvidenceTable.statementLineId, confirmedMergeLine.id));
  assert.equal(mergedEvidence[0]?.contactId, survivor.body.id);
  assert.equal(mergedEvidence[0]?.accountSuggestion, "Software & subscriptions");
  const mergeAudits = await database.db.select().from(database.contactMergeAuditsTable)
    .where(eq(database.contactMergeAuditsTable.id, merged.body.auditId));
  assert.equal(mergeAudits.length, 1);
  assert.deepEqual(new Set(mergeAudits[0]?.statementLineIds), new Set([confirmedMergeLine.id, reviewMergeLine.id]));
  await assert.rejects(database.db.update(database.contactMergeAuditsTable)
    .set({ mergedContactName: "Tampered" })
    .where(eq(database.contactMergeAuditsTable.id, merged.body.auditId)));
  await assert.rejects(database.db.update(database.contactClassificationEvidenceTable)
    .set({ contactId: duplicate.body.id })
    .where(eq(database.contactClassificationEvidenceTable.id, merged.body.evidenceIds[0])));

  assert.equal((await request<Contact>(`/agaraccounting/contacts/${duplicate.body.id}`, {
    method: "PATCH", body: JSON.stringify({ clientId, status: "active" }),
  })).response.status, 409);
  const matchedAfterMerge = await createLine("MERGE VENDOR SOURCE AFTER MERGE");
  assert.equal(matchedAfterMerge.contactId, survivor.body.id);
  const historyAfterMerge = await request<{ history: Array<{ statementLineId: number }> }>(
    `/agaraccounting/clients/${clientId}/contacts/${survivor.body.id}/history`,
  );
  assert.equal(historyAfterMerge.response.status, 200);
  assert.ok(historyAfterMerge.body.history.some((item) => item.statementLineId === confirmedMergeLine.id));

  for (const path of [
    `/agaraccounting/contacts?clientId=${foreignClientId}`,
    `/agaraccounting/clients/${foreignClientId}/contacts/${contact.body.id}/history`,
  ]) assert.equal((await request(path)).response.status, 403);
  assert.equal((await request(`/agaraccounting/statement-lines/${first.id}/contact`, {
    method: "PATCH", body: JSON.stringify({ clientId: foreignClientId, contactId: contact.body.id }),
  })).response.status, 403);
  const reviewLines = (await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`)).body;
  const validDecisionStates = new Set(["matched", "named_proposal", "needs_identification", "dismissed"]);
  assert.ok(reviewLines.filter((line) => line.contactReviewDisposition !== "accepted" || line.contactId == null)
    .every((line) => validDecisionStates.has(line.contactDecisionState)));
});

test("reuses a prior client mapping for a legacy unresolved line at posting", async () => {
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Recurring charges ${randomUUID()}`,
      legalName: "Recurring Charges LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "2026",
    }),
  });
  assert.equal(created.response.status, 201);
  clientId = created.body.id;

  const contact = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      displayName: "Harbor Retail",
      legalName: "Harbor Retail LLC",
      contactType: "supplier",
      aliases: ["HARBOR RETAIL"],
    }),
  });
  assert.equal(contact.response.status, 201);

  const firstMappedNarration = await createLine("POS PAYMENT BLUE HARBOR STORE 1188");
  assert.equal((await link(firstMappedNarration.id, contact.body.id)).response.status, 200);
  const legacyLine = await createLine("POS PAYMENT BLUE HARBOR STORE 7744");
  const legacyEntry = await entryFor(legacyLine.id);
  await database.db.update(database.statementLinesTable).set({
    contactId: null,
    proposedContactName: null,
    proposedContactAlias: null,
    proposedContactType: null,
    proposedContactConfidence: null,
    proposedContactSource: null,
    contactReviewDisposition: "pending",
  }).where(eq(database.statementLinesTable.id, legacyLine.id));
  await database.db.update(database.journalEntriesTable).set({
    contactId: null,
    status: "draft",
  }).where(eq(database.journalEntriesTable.id, legacyEntry.id));

  const displayedLegacyMatch = (await request<Line[]>(
    `/agaraccounting/statement-lines?clientId=${clientId}`,
  )).body.find((line) => line.id === legacyLine.id);
  assert.equal(displayedLegacyMatch?.contactId, contact.body.id);
  assert.match(displayedLegacyMatch?.contactSuggestionReason ?? "", /previous statement line/i);
  assert.equal((await post(legacyEntry.id)).response.status, 200);
  const [postedLegacyMatch] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, legacyLine.id));
  assert.equal(postedLegacyMatch?.contactId, contact.body.id);
});

test("posts through a stale learned-account recommendation, while recode confirmation still protects against a wrong one", async () => {
  await database.db.delete(database.classificationPatternsTable)
    .where(eq(database.classificationPatternsTable.userId, ownerId));
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Recurring charges ${randomUUID()}`,
      legalName: "Recurring Charges LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "2026",
    }),
  });
  assert.equal(created.response.status, 201);
  clientId = created.body.id;
  const bank = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      displayName: "Bank Fee Provider",
      legalName: "Bank Fee Provider LLC",
      contactType: "supplier",
      aliases: ["MONTHLY CHARGE PROVIDER"],
    }),
  });
  assert.equal(bank.response.status, 201);

  const confirmed = await createLine("BANK CHARGES - EMIRATES NBD; TXN 982731 / REF A91X22");
  assert.equal((await link(confirmed.id, bank.body.id)).response.status, 200);
  await recode(confirmed.id, "Bank charges");
  assert.equal((await post((await entryFor(confirmed.id)).id)).response.status, 200);

  const recurring = await createLine("Payment reference Z77Q10: Emirates, NBD bank service fee transaction 556677");
  assert.equal(recurring.contactId, bank.body.id);
  const recurringEntry = await entryFor(recurring.id);
  await database.db.update(database.journalEntriesTable).set({ debitAccount: "General expenses" })
    .where(eq(database.journalEntriesTable.id, recurringEntry.id));
  await database.db.update(database.statementLinesTable).set({ contactSuggestionEvidenceCount: null })
    .where(eq(database.statementLinesTable.id, recurring.id));

  const refreshed = (await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`))
    .body.find((line) => line.id === recurring.id);
  assert.equal(refreshed?.accountSuggestion, "Bank charges");
  assert.equal(refreshed?.journalAccount, "General expenses");
  assert.equal(refreshed?.accountConfirmationRequired, true);

  // Posting no longer requires the mismatch to be reconciled first: it goes
  // through with whatever account is already on the draft entry.
  const postedDespiteMismatch = await post(recurringEntry.id);
  assert.equal(postedDespiteMismatch.response.status, 200);
  const [postedEntry] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.id, recurringEntry.id));
  assert.equal(postedEntry?.debitAccount, "General expenses");
  assert.equal(postedEntry?.status, "posted");

  // The separate explicit recode-confirmation flow is unaffected: it still
  // rejects confirming a stale/wrong suggestion, and still applies a correct
  // one, ahead of posting that entry too.
  await database.db.delete(database.classificationPatternsTable)
    .where(eq(database.classificationPatternsTable.userId, ownerId));
  const secondRecurring = await createLine("Payment reference Z88R21: Emirates, NBD bank service fee transaction 992244");
  assert.equal(secondRecurring.contactId, bank.body.id);
  const secondRecurringEntry = await entryFor(secondRecurring.id);
  await recode(secondRecurring.id, "Bank charges");
  await database.db.update(database.journalEntriesTable).set({ debitAccount: "General expenses" })
    .where(eq(database.journalEntriesTable.id, secondRecurringEntry.id));
  await database.db.update(database.statementLinesTable).set({ contactSuggestionEvidenceCount: null })
    .where(eq(database.statementLinesTable.id, secondRecurring.id));

  const stale = await request<{ error: string }>("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "recode_lines",
      lineIds: [secondRecurring.id],
      accountSuggestion: "Office expenses",
      confidence: 0.9,
      confirmLearnedSuggestion: true,
    }),
  });
  assert.equal(stale.response.status, 409);
  assert.match(stale.body.error, /recommendation changed/i);

  const confirmedTreatment = await request("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "recode_lines",
      lineIds: [secondRecurring.id],
      accountSuggestion: "Bank charges",
      confidence: 0.9,
      confirmLearnedSuggestion: true,
    }),
  });
  assert.equal(confirmedTreatment.response.status, 200);
  const [storedLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, secondRecurring.id));
  const [storedEntry] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.id, secondRecurringEntry.id));
  assert.equal(storedLine?.accountSuggestion, "Bank charges");
  assert.equal(storedEntry?.debitAccount, "Bank charges");
  assert.equal(storedEntry?.status, "draft");
  assert.equal(storedLine?.status, "draft");
  assert.equal((await post(secondRecurringEntry.id)).response.status, 200);

  await Promise.all(Array.from({ length: 30 }, (_, index) =>
    createLine(`Monthly bank service charge payment reference PERF-${index}-2026`)
  ));
  const listingStartedAt = performance.now();
  const largeListing = await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`);
  const listingDurationMs = performance.now() - listingStartedAt;
  assert.equal(largeListing.response.status, 200);
  assert.ok(largeListing.body.length >= 32);
  assert.ok(listingDurationMs < 5_000, `Expected batched statement review lookup under 5s, took ${listingDurationMs}ms`);
});

test("bulk posting treats learned account recommendations as optional", async () => {
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Optional bulk recommendation ${randomUUID()}`,
      legalName: "Optional Bulk Recommendation LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "2026",
    }),
  });
  assert.equal(created.response.status, 201);
  clientId = created.body.id;

  const bank = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      displayName: "Optional Recommendation Bank",
      legalName: "Optional Recommendation Bank LLC",
      contactType: "supplier",
      aliases: ["EMIRATES NBD"],
    }),
  });
  assert.equal(bank.response.status, 201);

  const confirmed = await createLine("BANK CHARGES - EMIRATES NBD; TXN 982731 / REF A91X22");
  assert.equal((await link(confirmed.id, bank.body.id)).response.status, 200);
  await recode(confirmed.id, "Bank charges");
  assert.equal((await post((await entryFor(confirmed.id)).id)).response.status, 200);

  const recurring = await createLine("Payment reference Z81B20: Emirates, NBD bank service fee transaction 883311");
  const recurringEntry = await entryFor(recurring.id);
  await database.db.update(database.journalEntriesTable).set({ debitAccount: "General expenses" })
    .where(eq(database.journalEntriesTable.id, recurringEntry.id));
  await database.db.update(database.statementLinesTable).set({ contactSuggestionEvidenceCount: null })
    .where(eq(database.statementLinesTable.id, recurring.id));

  const refreshed = (await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`))
    .body.find((line) => line.id === recurring.id);
  assert.equal(refreshed?.accountSuggestion, "Bank charges");
  assert.equal(refreshed?.journalAccount, "General expenses");
  assert.equal(refreshed?.accountConfirmationRequired, true);

  const bulkPost = await request<{ entryCount: number }>("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "bulk_post_entries",
      entryIds: [recurringEntry.id],
      statementLineIds: [recurring.id],
    }),
  });
  assert.equal(bulkPost.response.status, 200);
  assert.equal(bulkPost.body.entryCount, 1);
  const [postedEntry] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.id, recurringEntry.id));
  assert.equal(postedEntry?.debitAccount, "General expenses");
  assert.equal(postedEntry?.status, "posted");
});

test("applies Bank charges contact assignment in one chat turn without guessing", async () => {
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `AI assign contacts ${randomUUID()}`,
      legalName: "AI Assign Contacts LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "2026",
    }),
  });
  assert.equal(created.response.status, 201);
  const scopedClientId = created.body.id;
  await database.db.insert(database.clientWorkspacesTable).values({ clientId: scopedClientId, userId: memberId, role: "bookkeeper" });

  // Ensure the seeded chart is present, then resolve Bank charges from it.
  await request("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      date: "2026-09-01",
      description: "SEED CHART",
      currency: "AED",
      amount: 1,
      direction: "outflow",
    }),
  });
  const accounts = await request<Array<{ id: number; accountName: string }>>(
    `/agaraccounting/accounts?clientId=${scopedClientId}`,
  );
  assert.equal(accounts.response.status, 200);
  const bankChargesAccount = accounts.body.find((account) => account.accountName === "Bank charges");
  assert.ok(bankChargesAccount, "Expected seeded Bank charges account");
  const bankCharges = bankChargesAccount;

  const mashreq = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      displayName: "Mashreq Bank",
      legalName: "Mashreq Bank PSC",
      contactType: "supplier",
      aliases: ["MASHREQ"],
    }),
  });
  assert.equal(mashreq.response.status, 201);

  const foreign = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Foreign assign ${randomUUID()}`,
      legalName: "Foreign Assign LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "2026",
    }),
  }, foreignId);
  assert.equal(foreign.response.status, 201);
  const foreignMashreq = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId: foreign.body.id,
      displayName: "Mashreq Bank",
      legalName: "Mashreq Bank Foreign",
      contactType: "supplier",
    }),
  }, foreignId);
  assert.equal(foreignMashreq.response.status, 201);

  async function createScopedLine(description: string, accountSuggestion?: string) {
    const line = await request<Line>("/agaraccounting/statement-lines", {
      method: "POST",
      body: JSON.stringify({
        clientId: scopedClientId,
        date: "2026-09-15",
        description,
        currency: "AED",
        amount: 25,
        direction: "outflow",
      }),
    });
    assert.equal(line.response.status, 201);
    if (accountSuggestion) {
      const entries = await request<Array<{ id: number; statementLineId: number }>>(
        `/agaraccounting/journal-entries?clientId=${scopedClientId}`,
      );
      const entry = entries.body.find((item) => item.statementLineId === line.body.id);
      assert.ok(entry);
      await database.db.update(database.statementLinesTable).set({
        accountSuggestion,
        accountClassificationId: bankCharges.id,
        proposedContactName: "Temp Fee Vendor",
        proposedContactAlias: "Temp Fee Vendor",
        proposedContactType: "supplier",
        proposedContactConfidence: "0.7",
        proposedContactSource: "heuristic_description",
      }).where(eq(database.statementLinesTable.id, line.body.id));
      await database.db.update(database.journalEntriesTable).set({
        debitAccount: accountSuggestion,
        debitAccountClassificationId: bankCharges.id,
      }).where(eq(database.journalEntriesTable.id, entry.id));
    }
    return line.body;
  }

  const chargeLine = await createScopedLine("CARD FEE REF 1001", "Bank charges");
  const otherAccountLine = await createScopedLine("OFFICE SUPPLIES INVOICE 55");
  const untouchedProposal = await createScopedLine("OTHER FEE", "Bank charges");
  const postedCharge = await createScopedLine("POSTED BANK FEE", "Bank charges");
  const postedEntries = await request<Array<{ id: number; statementLineId: number }>>(
    `/agaraccounting/journal-entries?clientId=${scopedClientId}`,
  );
  const postedEntry = postedEntries.body.find((item) => item.statementLineId === postedCharge.id);
  assert.ok(postedEntry);
  assert.equal((await request(`/agaraccounting/statement-lines/${postedCharge.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId: scopedClientId, contactId: null, contactReviewDisposition: "dismissed" }),
  })).response.status, 200);
  assert.equal((await request(`/agaraccounting/journal-entries/${postedEntry.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId: scopedClientId }),
  })).response.status, 200);

  const missing = await request<{ answer: string; recommendations: Array<{ type: string }> }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      message: "update all Bank charges statement lines' proposed contact to Missing Bank",
    }),
  });
  assert.equal(missing.response.status, 200);
  assert.equal(missing.body.recommendations.length, 0);
  assert.match(missing.body.answer, /could not find an active contact/i);
  const [untouchedAfterMissing] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, chargeLine.id));
  assert.equal(untouchedAfterMissing?.contactId, null);
  assert.equal(untouchedAfterMissing?.proposedContactName, "Temp Fee Vendor");

  const archivedContact = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      displayName: "Archived Fee Bank",
      legalName: "Archived Fee Bank LLC",
      contactType: "supplier",
    }),
  });
  assert.equal(archivedContact.response.status, 201);
  assert.equal((await request(`/agaraccounting/contacts/${archivedContact.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ clientId: scopedClientId, status: "archived" }),
  })).response.status, 200);
  const archivedPrompt = await request<{ answer: string; recommendations: unknown[] }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      message: "update all Bank charges statement lines' proposed contact to Archived Fee Bank",
    }),
  });
  assert.equal(archivedPrompt.response.status, 200);
  assert.equal(archivedPrompt.body.recommendations.length, 0);
  assert.match(archivedPrompt.body.answer, /archived/i);

  const duplicate = await request<Contact>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      displayName: "Duplicate Bank",
      legalName: "Duplicate Bank A LLC",
      contactType: "supplier",
    }),
  });
  assert.equal(duplicate.response.status, 201);
  await database.db.insert(database.contactsTable).values({
    clientId: scopedClientId,
    displayName: "Duplicate Bank",
    legalName: "Duplicate Bank B LLC",
    contactType: "supplier",
    status: "active",
  });
  const ambiguous = await request<{ answer: string; recommendations: unknown[] }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      message: "update all Bank charges statement lines' proposed contact to Duplicate Bank",
    }),
  });
  assert.equal(ambiguous.response.status, 200);
  assert.equal(ambiguous.body.recommendations.length, 0);
  assert.match(ambiguous.body.answer, /more than one contact/i);

  const aliasApplied = await request<{
    recommendations: Array<{ type: string; applied?: boolean; contactId?: number; contactName?: string }>;
  }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      message: "update all Bank charges statement lines' proposed contact to MASHREQ",
    }),
  });
  assert.equal(aliasApplied.response.status, 200);
  assert.equal(aliasApplied.body.recommendations[0]?.type, "assign_contacts");
  assert.equal(aliasApplied.body.recommendations[0]?.applied, true);
  assert.equal(aliasApplied.body.recommendations[0]?.contactId, mashreq.body.id);

  // Reset proposals on one line to re-test the display-name path after alias assignment
  await database.db.update(database.statementLinesTable).set({
    contactId: null,
    proposedContactName: "Temp Fee Vendor",
    proposedContactAlias: "Temp Fee Vendor",
    proposedContactType: "supplier",
    proposedContactConfidence: "0.7",
    proposedContactSource: "heuristic_description",
    contactReviewDisposition: "pending",
  }).where(eq(database.statementLinesTable.id, untouchedProposal.id));
  await database.db.update(database.journalEntriesTable).set({ contactId: null })
    .where(eq(database.journalEntriesTable.statementLineId, untouchedProposal.id));

  const applied = await request<{
    answer: string;
    recommendations: Array<{
      type: string;
      applied?: boolean;
      requiresConfirmation?: boolean;
      contactId?: number;
      contactName?: string;
      lineIds?: number[];
      lineCount?: number;
      summary?: string;
    }>;
  }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      message: "Assign all Bank charges to Mashreq Bank.",
    }),
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.recommendations.length, 1);
  assert.equal(applied.body.recommendations[0]?.type, "assign_contacts");
  assert.equal(applied.body.recommendations[0]?.applied, true);
  assert.equal(applied.body.recommendations[0]?.requiresConfirmation, false);
  assert.equal(applied.body.recommendations[0]?.contactId, mashreq.body.id);
  assert.notEqual(applied.body.recommendations[0]?.contactId, foreignMashreq.body.id);
  assert.equal(applied.body.recommendations[0]?.contactName, "Mashreq Bank");
  assert.ok(applied.body.recommendations[0]?.lineIds?.includes(chargeLine.id));
  assert.ok(applied.body.recommendations[0]?.lineIds?.includes(untouchedProposal.id));
  assert.ok(!applied.body.recommendations[0]?.lineIds?.includes(otherAccountLine.id));
  assert.ok(!applied.body.recommendations[0]?.lineIds?.includes(postedCharge.id));
  assert.match(applied.body.recommendations[0]?.summary ?? "", /posted/i);

  const [storedCharge] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, chargeLine.id));
  assert.equal(storedCharge?.contactId, mashreq.body.id);
  assert.equal(storedCharge?.proposedContactName, null);
  assert.equal(storedCharge?.proposedContactAlias, null);
  assert.equal(storedCharge?.proposedContactType, null);
  assert.equal(storedCharge?.proposedContactSource, null);
  assert.equal(storedCharge?.contactReviewDisposition, "replaced");

  const [storedPosted] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, postedCharge.id));
  assert.equal(storedPosted?.status, "posted");
  assert.notEqual(storedPosted?.contactId, mashreq.body.id);

  const chargeEntry = await request<Array<{ id: number; statementLineId: number; contactId: number | null }>>(
    `/agaraccounting/journal-entries?clientId=${scopedClientId}`,
  );
  const linked = chargeEntry.body.find((item) => item.statementLineId === chargeLine.id);
  assert.equal(linked?.contactId, mashreq.body.id);

  const [otherStored] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, otherAccountLine.id));
  assert.equal(otherStored?.contactId, null);

  const mixed = await request<{ answer: string; recommendations: unknown[] }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      message: "update all Bank charges proposed contact to Mashreq Bank and post them",
    }),
  });
  assert.equal(mixed.response.status, 200);
  assert.equal(mixed.body.recommendations.length, 0);
  assert.match(mixed.body.answer, /separate steps/i);

  const report = await request<{ answer: string; recommendations: unknown[]; results?: unknown[] }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      message: "Show the trial balance",
    }),
  });
  assert.equal(report.response.status, 200);
  assert.equal(report.body.recommendations.length, 0);
  assert.ok(Array.isArray(report.body.results));

  const postCard = await request<{
    recommendations: Array<{ type: string; requiresConfirmation?: boolean; entryIds?: number[] }>;
  }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: scopedClientId,
      message: "Post all draft entries",
    }),
  });
  assert.equal(postCard.response.status, 200);
  assert.equal(postCard.body.recommendations[0]?.type, "bulk_post_entries");
  assert.equal(postCard.body.recommendations[0]?.requiresConfirmation, true);
  const stillDraft = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.clientId, scopedClientId));
  assert.ok(stillDraft.some((entry) => entry.status !== "posted"));
});

test("reverses mistaken account learning when a posted line is reopened and corrected", async () => {
  const accounts = await request<Array<{ accountName: string }>>(
    `/agaraccounting/accounts?clientId=${clientId}`,
  );
  assert.equal(accounts.response.status, 200);
  assert.ok(accounts.body.some((account) => account.accountName === "Other income"));
  assert.ok(accounts.body.some((account) => account.accountName === "Revenue"));

  const description = `RECURRING CUSTOMER RECEIPT ${randomUUID()}`;
  const mistakenLine = await createLine(description, "AED", 450, "inflow");
  const mistakenEntry = await entryFor(mistakenLine.id);
  const mistakenPost = await request<{ status: string }>(
    `/agaraccounting/journal-entries/${mistakenEntry.id}/post`,
    {
      method: "POST",
      body: JSON.stringify({ clientId, accountSuggestion: "Other income", contactId: null }),
    },
  );
  assert.equal(mistakenPost.response.status, 200);
  const [mistakenPattern] = await database.db.select()
    .from(database.classificationPatternsTable)
    .where(and(
      eq(database.classificationPatternsTable.userId, ownerId),
      eq(database.classificationPatternsTable.accountSuggestion, "Other income"),
    ));
  assert.ok(mistakenPattern);

  const reopened = await request<{ status: string }>(
    `/agaraccounting/journal-entries/${mistakenEntry.id}/unpost`,
    {
      method: "POST",
      body: JSON.stringify({ clientId }),
    },
  );
  assert.equal(reopened.response.status, 200);
  assert.equal(reopened.body.status, "draft");
  await database.db.insert(database.classificationPatternsTable).values({
    userId: ownerId,
    normalizedVendor: mistakenPattern.normalizedVendor,
    accountSuggestion: "Other income",
    confidence: mistakenPattern.confidence,
    confirmationCount: 1,
  });

  await recode(mistakenLine.id, "Revenue");
  const correctedLines = await request<Line[]>(
    `/agaraccounting/statement-lines?clientId=${clientId}`,
  );
  assert.equal(correctedLines.response.status, 200);
  const correctedLine = correctedLines.body.find((line) => line.id === mistakenLine.id);
  assert.equal(correctedLine?.accountSuggestion, "Revenue");
  assert.equal(correctedLine?.journalAccount, "Revenue");

  const nextLine = await createLine(description, "AED", 500, "inflow");
  assert.equal(nextLine.accountSuggestion, "Revenue");
  assert.equal(nextLine.supportingPatternCount, 1);
});

test("exports selected statement lines as Excel and PDF without writing other clients", async () => {
  const line = await createLine(`EXPORT LINE ${randomUUID()}`);
  const excel = await fetch(`${baseUrl}/agaraccounting/statement-lines/export`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user-id": ownerId },
    body: JSON.stringify({ clientId, lineIds: [line.id], format: "xlsx" }),
  });
  assert.equal(excel.status, 200);
  assert.match(excel.headers.get("content-type") ?? "", /spreadsheetml/);
  assert.match(excel.headers.get("content-disposition") ?? "", /statement-lines\.xlsx/);
  const excelBytes = Buffer.from(await excel.arrayBuffer());
  assert.ok(excelBytes.length > 100);

  const pdf = await fetch(`${baseUrl}/agaraccounting/statement-lines/export`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user-id": ownerId },
    body: JSON.stringify({ clientId, lineIds: [line.id], format: "pdf" }),
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdfBytes.toString("utf8"), /EXPORT LINE/);

  const missing = await request<{ error: string }>("/agaraccounting/statement-lines/export", {
    method: "POST",
    body: JSON.stringify({ clientId, lineIds: [9_999_999], format: "xlsx" }),
  });
  assert.equal(missing.response.status, 400);

  const crossClient = await request<{ error: string }>("/agaraccounting/statement-lines/export", {
    method: "POST",
    body: JSON.stringify({ clientId: foreignClientId, lineIds: [line.id], format: "pdf" }),
  }, foreignId);
  assert.equal(crossClient.response.status, 400);
});

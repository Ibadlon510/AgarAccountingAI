import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";

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
  contactSuggestionStatus: string | null; supportingPatternCount: number; functionalAmount: number | null;
};

async function createLine(description: string, currency = "AED", amount = 100): Promise<Line> {
  const result = await request<Line>("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId, date: "2026-09-15", description, currency, amount, direction: "outflow",
    }),
  });
  assert.equal(result.response.status, 201);
  return result.body;
}

async function entryFor(lineId: number) {
  const entries = await request<Array<{ id: number; statementLineId: number; status: string }>>(
    `/agaraccounting/journal-entries?clientId=${clientId}`,
  );
  assert.equal(entries.response.status, 200);
  const entry = entries.body.find((candidate) => candidate.statementLineId === lineId);
  assert.ok(entry, `Expected journal entry for statement line ${lineId}.`);
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

async function approve(entryId: number) {
  const result = await request<{ status: string }>(`/agaraccounting/journal-entries/${entryId}/approve`, {
    method: "POST", body: JSON.stringify({ clientId }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "approved");
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

test("uses client-scoped contact history without bypassing approval or chart safeguards", async () => {
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Contacts ${randomUUID()}`, legalName: "Contacts Test LLC", functionalCurrency: "AED", basis: "IFRS", period: "2026" }),
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
  const updated = await request<Contact>(`/agaraccounting/contacts/${contact.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, aliases: ["ACME PAYMENTS", "ACME BANK"] }),
  });
  assert.equal(updated.response.status, 200);
  assert.ok(updated.body.aliases.includes("ACME BANK"));
  const listed = await request<Contact[]>(`/agaraccounting/contacts?clientId=${clientId}`, undefined, memberId);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body[0]?.id, contact.body.id);

  const first = await createLine("CARD PAYMENT ACME BANK INV 1001");
  assert.equal(first.contactId, contact.body.id);
  assert.equal(first.contactSuggestionStatus, "no_history");
  const firstEntry = await entryFor(first.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${firstEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 409);
  const correction = await link(first.id, contact.body.id);
  assert.equal(correction.response.status, 200);
  await recode(first.id, contactAccount.body.accountName);
  await approve(firstEntry.id);

  const evidence = await database.db.select().from(database.contactClassificationEvidenceTable)
    .where(eq(database.contactClassificationEvidenceTable.statementLineId, first.id));
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.accountSuggestion, contactAccount.body.accountName);
  assert.equal(evidence[0]?.entryStatus, "approved");
  assert.equal((await link(first.id, contact.body.id)).response.status, 409);

  const weak = await createLine("ACME BANK SEPTEMBER");
  assert.equal(weak.contactSuggestionStatus, "weak");
  assert.equal(weak.accountSuggestion, contactAccount.body.accountName);
  assert.equal(weak.supportingPatternCount, 1);
  const weakEntry = await entryFor(weak.id);
  await approve(weakEntry.id);

  // A deterministic client-scoped rate makes the EUR history approval valid.
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
  await approve(supportedEntry.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${supportedEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);

  const history = await request<{ history: Array<{ currency: string; status: string }>; treatmentSummary: Array<{ accountTreatment: string; count: number; currencies: string[] }> }>(
    `/agaraccounting/clients/${clientId}/contacts/${contact.body.id}/history`,
  );
  assert.equal(history.response.status, 200);
  assert.deepEqual(history.body.treatmentSummary, [{ accountTreatment: contactAccount.body.accountName, count: 3, currencies: ["AED", "EUR"] }]);
  assert.deepEqual(new Set(history.body.history.map((row) => row.status)), new Set(["approved", "posted"]));

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
  await approve((await entryFor(conflictSeed.id)).id);
  const conflictCorrection = await createLine("CONFLICT VENDOR COMMUNICATIONS");
  assert.equal(conflictCorrection.contactSuggestionStatus, "weak");
  await recode(conflictCorrection.id, "Communication expenses");
  await approve((await entryFor(conflictCorrection.id)).id);
  const conflicting = await createLine("CONFLICT VENDOR FINAL CHECK");
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
  await approve((await entryFor(staleSeed.id)).id);
  const staleProposal = await createLine("STALE VENDOR PENDING");
  assert.equal(staleProposal.contactSuggestionStatus, "weak");
  const changedEvidence = await createLine("STALE VENDOR PHONE");
  await recode(changedEvidence.id, "Communication expenses");
  await approve((await entryFor(changedEvidence.id)).id);
  const staleProposalEntry = await entryFor(staleProposal.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${staleProposalEntry.id}/approve`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 409);
  await recode(staleProposal.id, "Software & subscriptions");
  await approve(staleProposalEntry.id);
  const postAfterArchiveEntry = await entryFor(staleSeed.id);
  assert.equal((await request<Contact>(`/agaraccounting/contacts/${staleContact.body.id}`, {
    method: "PATCH", body: JSON.stringify({ clientId, status: "archived" }),
  })).response.status, 200);
  assert.equal((await request(`/agaraccounting/journal-entries/${postAfterArchiveEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 409);

  const archived = await request<Contact>(`/agaraccounting/contacts/${contact.body.id}`, {
    method: "PATCH", body: JSON.stringify({ clientId, status: "archived" }),
  });
  assert.equal(archived.response.status, 200);
  const noMatch = await createLine("ACME BANK AFTER CONTACT ARCHIVE");
  assert.equal(noMatch.contactId, null);
  assert.equal(noMatch.contactSuggestionStatus, null);

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
  await approve(confirmedMergeEntry.id);
  assert.equal((await request(`/agaraccounting/journal-entries/${confirmedMergeEntry.id}/post`, {
    method: "POST", body: JSON.stringify({ clientId }),
  })).response.status, 200);
  const reviewMergeLine = await createLine("MERGE VENDOR SOURCE PENDING");
  const reviewMergeEntry = await entryFor(reviewMergeLine.id);
  assert.equal(reviewMergeLine.contactId, duplicate.body.id);
  assert.equal(reviewMergeEntry.status, "suggested");

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
  assert.ok(mergedLines.some((line) => line.id === reviewMergeLine.id && line.status === "needs_review"));
  const mergedEntries = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.contactId, survivor.body.id));
  assert.ok(mergedEntries.some((entry) =>
    entry.id === confirmedMergeEntry.id
    && entry.status === "posted"
    && entry.debitAccount === "Software & subscriptions",
  ));
  assert.ok(mergedEntries.some((entry) => entry.id === reviewMergeEntry.id && entry.status === "suggested"));
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
});
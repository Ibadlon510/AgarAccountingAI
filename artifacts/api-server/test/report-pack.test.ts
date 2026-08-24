import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportPack } from "../src/lib/reportPack";

test("blocks a draft pack with missing comparatives and accountant inputs", () => {
  const result = buildReportPack({
    client: {
      id: 1,
      name: "Test entity",
      legalName: "Test entity LLC",
      functionalCurrency: "AED",
    } as never,
    entries: [{
      id: 10,
      clientId: 1,
      statementLineId: 20,
      date: "2026-06-01",
      status: "posted",
      debitAccount: "General expenses",
      creditAccount: "Bank / cash",
      amount: "100",
      functionalAmount: "100",
      functionalCurrency: "AED",
    }] as never,
    classifications: [],
    periodEnd: "2026-12-31",
    presentationCurrency: "AED",
    reportingBasis: "IFRS",
    presentationProfile: "IAS 1",
    roundingPolicy: "Nearest whole unit",
    sourceImportCount: 1,
    missingRateEntries: [],
  });

  assert.equal(result.snapshot.traceability.postedEntryCount, 1);
  assert.equal(result.snapshot.cashFlows.find((row) => row.label === "Cash at end of year")?.current, -100);
  assert.equal(result.validation.status, "blocked");
  assert.equal(result.validation.checks.find((check) => check.id === "comparatives")?.blocking, true);
  assert.equal(result.validation.checks.find((check) => check.id === "notes")?.status, "error");
  assert.equal(result.checklist.length, 12);
});
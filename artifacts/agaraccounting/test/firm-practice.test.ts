import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysLeft,
  DEFAULT_ENGAGEMENT_TERMS,
  ENGAGEMENT_SERVICE_OPTIONS,
  firmLandingFallbackPath,
  firmSlugError,
  firmSlugFromHost,
  isFirmPracticePath,
  landingPathForMode,
  monthInputToPeriod,
  onboardingStatusLabel,
  ownershipLabel,
  periodToMonthInput,
  practiceStatusLabel,
  publicFirmHost,
  shouldShowPersistentFirmWall,
  showsFirmNavigation,
  slugifyFirmName,
} from "../src/lib/firm-landing";

test("lands firm and dual-mode users on the practice dashboard", () => {
  assert.equal(landingPathForMode("firm"), "/firm-dashboard");
  assert.equal(landingPathForMode("both"), "/firm-dashboard");
  assert.equal(landingPathForMode("company"), "/user-portal");
  assert.equal(landingPathForMode(undefined), "/user-portal");
  assert.equal(landingPathForMode(null), "/user-portal");
});

test("shows the Firm nav group only for firm and dual-mode users", () => {
  assert.equal(showsFirmNavigation("firm"), true);
  assert.equal(showsFirmNavigation("both"), true);
  assert.equal(showsFirmNavigation("company"), false);
  assert.equal(showsFirmNavigation(undefined), false);
});

test("lands lapsed and locked firm-only users on the subscribe page", () => {
  assert.equal(landingPathForMode("firm", "trialing"), "/firm-dashboard");
  assert.equal(landingPathForMode("firm", "lapsed_readonly"), "/billing/firm");
  assert.equal(landingPathForMode("firm", "locked"), "/billing/firm");
  assert.equal(landingPathForMode("both", "locked"), "/user-portal");
  assert.equal(landingPathForMode("both", "lapsed_readonly"), "/user-portal");
});

test("hides the Firm nav group after the trial unless Firm Pro is active", () => {
  assert.equal(showsFirmNavigation("firm", true), true);
  assert.equal(showsFirmNavigation("firm", false), false);
  assert.equal(showsFirmNavigation("both", false), false);
  assert.equal(showsFirmNavigation("company", true), false);
});

test("treats firm dashboard, client, settings, onboard, and subscribe routes as practice paths", () => {
  assert.equal(isFirmPracticePath("/firm-dashboard"), true);
  assert.equal(isFirmPracticePath("/firm-clients"), true);
  assert.equal(isFirmPracticePath("/firm-clients/42"), true);
  assert.equal(isFirmPracticePath("/firm-settings"), true);
  assert.equal(isFirmPracticePath("/firm-onboard"), true);
  assert.equal(isFirmPracticePath("/billing/firm"), true);
  assert.equal(isFirmPracticePath("/user-portal"), false);
  assert.equal(isFirmPracticePath("/journal-entries"), false);
});

test("keeps the locked firm wall on firm-liable pages and lets dual-mode users keep their own books", () => {
  assert.equal(shouldShowPersistentFirmWall({ path: "/journal-entries", mode: "firm", firmStatus: "locked" }), true);
  assert.equal(shouldShowPersistentFirmWall({ path: "/firm-settings", mode: "firm", firmStatus: "locked" }), false);
  assert.equal(shouldShowPersistentFirmWall({ path: "/billing/firm", mode: "firm", firmStatus: "locked" }), false);
  assert.equal(shouldShowPersistentFirmWall({ path: "/user-portal", mode: "both", firmStatus: "locked", liableParty: "company" }), false);
  assert.equal(shouldShowPersistentFirmWall({ path: "/journal-entries", mode: "both", firmStatus: "locked", liableParty: "firm" }), true);
  assert.equal(shouldShowPersistentFirmWall({ path: "/firm-dashboard", mode: "both", firmStatus: "lapsed_readonly" }), false);
});

test("opens a portfolio client on the firm mini-dashboard, not Close overview", () => {
  const clientId = 17;
  assert.equal(`/firm-clients/${clientId}`, "/firm-clients/17");
  assert.equal(isFirmPracticePath(`/firm-clients/${clientId}`), true);
  assert.notEqual(`/firm-clients/${clientId}`, "/user-portal");
});

test("counts whole days remaining before firm confirmation expires", () => {
  const now = new Date("2026-09-02T08:00:00.000Z");
  assert.equal(daysLeft("2026-09-07T08:00:00.000Z", now), 5);
  assert.equal(daysLeft(new Date("2026-09-03T07:00:00.000Z"), now), 1);
  assert.equal(daysLeft("2026-09-01T08:00:00.000Z", now), 0);
  assert.equal(daysLeft(null, now), null);
  assert.equal(daysLeft("not-a-date", now), null);
});

test("uses human-readable practice status and close-period month values", () => {
  assert.equal(onboardingStatusLabel("sent"), "Awaiting signature");
  assert.equal(onboardingStatusLabel("signed"), "Awaiting your confirmation");
  assert.equal(practiceStatusLabel("expired", "expired"), "Expired");
  assert.equal(ownershipLabel("firm_provisional"), "Firm provisional");
  assert.equal(monthInputToPeriod("2026-08"), "August 2026");
  assert.equal(periodToMonthInput("August 2026"), "2026-08");
});

test("seeds engagement services and in-app acknowledgement terms", () => {
  assert.deepEqual(ENGAGEMENT_SERVICE_OPTIONS.map((option) => option.id), [
    "bookkeeping",
    "statement_review",
    "journals",
    "ifrs_pack",
    "uae_tax_estimate",
  ]);
  assert.match(DEFAULT_ENGAGEMENT_TERMS, /transactions per month/i);
  assert.match(DEFAULT_ENGAGEMENT_TERMS, /revenue per year/i);
  assert.match(DEFAULT_ENGAGEMENT_TERMS, /five days/i);
  assert.match(DEFAULT_ENGAGEMENT_TERMS, /not a qualified electronic signature/i);
});

test("builds a unique white-label host from the firm slug", () => {
  assert.equal(slugifyFirmName("North Star Partners"), "north-star-partners");
  assert.equal(firmSlugError("www"), "That address is reserved. Choose another slug.");
  assert.equal(firmSlugFromHost("northstar.agaraccounting.com"), "northstar");
  assert.equal(firmSlugFromHost("app.agaraccounting.com"), null);
  assert.equal(firmSlugFromHost("localhost"), null);
  assert.equal(publicFirmHost("northstar"), "northstar.agaraccounting.com");
  assert.equal(firmLandingFallbackPath("northstar"), "/f/northstar");
});

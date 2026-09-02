import assert from "node:assert/strict";
import { test } from "node:test";
import { remainingIntro } from "../src/lib/billing-ui";

test("counts a live intro-rate countdown until 31 Dec 2026 Dubai", () => {
  const introEndsAt = "2026-12-31T19:59:59.000Z";
  const left = remainingIntro(introEndsAt, new Date("2026-12-30T19:59:59.000Z"));
  assert.equal(left.expired, false);
  assert.equal(left.days, 1);
  assert.equal(left.hours, 0);
});

test("hides the intro countdown after the deadline", () => {
  const left = remainingIntro("2026-12-31T19:59:59.000Z", new Date("2027-01-01T00:00:00+04:00"));
  assert.equal(left.expired, true);
  assert.equal(left.days, 0);
});

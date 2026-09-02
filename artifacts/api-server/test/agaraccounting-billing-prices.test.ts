import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  INTRO_PRICES_AED,
  LIST_PRICES_AED,
  resolveCheckoutPrice,
} from "../src/lib/billing";
import { constructStripeEvent } from "../src/lib/stripeBilling";

test("checkout uses intro AED 19 for firm members during 2026 and list 69/99 after the deadline", () => {
  const introMember = resolveCheckoutPrice("company", { isFirmMember: true, now: new Date("2026-06-01T08:00:00+04:00") });
  assert.equal(introMember.kind, "company_pro_firm_member");
  assert.equal(introMember.amount, INTRO_PRICES_AED.companyProFirmMember);
  assert.equal(introMember.listAmount, LIST_PRICES_AED.companyProFirmMember);
  assert.equal(introMember.intro, true);
  assert.ok(introMember.scheduleToListAt);

  const introStandard = resolveCheckoutPrice("company", { isFirmMember: false, now: new Date("2026-06-01T08:00:00+04:00") });
  assert.equal(introStandard.amount, INTRO_PRICES_AED.companyPro);
  assert.equal(introStandard.kind, "company_pro");

  const introFirm = resolveCheckoutPrice("firm", { now: new Date("2026-12-31T23:00:00+04:00") });
  assert.equal(introFirm.amount, INTRO_PRICES_AED.firm);
  assert.equal(introFirm.listAmount, LIST_PRICES_AED.firm);

  const listMember = resolveCheckoutPrice("company", { isFirmMember: true, now: new Date("2027-01-01T00:00:00+04:00") });
  assert.equal(listMember.intro, false);
  assert.equal(listMember.amount, LIST_PRICES_AED.companyProFirmMember);
  assert.equal(listMember.scheduleToListAt, null);

  const listStandard = resolveCheckoutPrice("company", { isFirmMember: false, now: new Date("2027-01-01T00:00:00+04:00") });
  assert.equal(listStandard.amount, LIST_PRICES_AED.companyPro);

  const listFirm = resolveCheckoutPrice("firm", { now: new Date("2027-06-01T00:00:00+04:00") });
  assert.equal(listFirm.amount, LIST_PRICES_AED.firm);
});

test("accepts a replayed Stripe webhook signature", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_replay";
  const payload = Buffer.from(JSON.stringify({
    type: "customer.subscription.updated",
    data: { object: { id: "sub_replay" } },
  }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", "whsec_test_replay").update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");
  const event = await constructStripeEvent(payload, `t=${timestamp},v1=${digest}`);
  assert.equal(event.type, "customer.subscription.updated");
  await assert.rejects(() => constructStripeEvent(payload, `t=${timestamp},v1=deadbeef`), /mismatch/i);
});

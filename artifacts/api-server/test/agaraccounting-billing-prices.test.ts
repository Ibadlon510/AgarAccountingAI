import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  INTRO_RATES_END_AT,
  INTRO_PRICES_AED,
  LIST_PRICES_AED,
  resolveCheckoutPrice,
} from "../src/lib/billing";
import {
  constructStripeEvent,
  introListSchedulePlan,
  listPriceForIntroPrice,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
} from "../src/lib/stripeBilling";

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

  const lastIntroMillisecond = resolveCheckoutPrice("firm", { now: new Date(INTRO_RATES_END_AT.getTime() - 1) });
  assert.equal(lastIntroMillisecond.intro, true);
  const exactCutoff = resolveCheckoutPrice("firm", { now: new Date(INTRO_RATES_END_AT) });
  assert.equal(exactCutoff.intro, false);

  const listMember = resolveCheckoutPrice("company", { isFirmMember: true, now: new Date("2027-01-01T00:00:00+04:00") });
  assert.equal(listMember.intro, false);
  assert.equal(listMember.amount, LIST_PRICES_AED.companyProFirmMember);
  assert.equal(listMember.scheduleToListAt, null);

  const listStandard = resolveCheckoutPrice("company", { isFirmMember: false, now: new Date("2027-01-01T00:00:00+04:00") });
  assert.equal(listStandard.amount, LIST_PRICES_AED.companyPro);

  const listFirm = resolveCheckoutPrice("firm", { now: new Date("2027-06-01T00:00:00+04:00") });
  assert.equal(listFirm.amount, LIST_PRICES_AED.firm);
});

test("verifies current Stripe signatures and rejects stale signatures", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_replay";
  const created = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    id: "evt_replay",
    created,
    type: "customer.subscription.updated",
    data: { object: { id: "sub_replay" } },
  }));
  const timestamp = String(created);
  const digest = createHmac("sha256", "whsec_test_replay").update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");
  const event = await constructStripeEvent(payload, `t=${timestamp},v1=${digest}`);
  assert.equal(event.type, "customer.subscription.updated");
  await assert.rejects(() => constructStripeEvent(payload, `t=${timestamp},v1=deadbeef`), /mismatch/i);
  const stale = String(created - STRIPE_WEBHOOK_TOLERANCE_SECONDS - 1);
  const staleDigest = createHmac("sha256", "whsec_test_replay").update(`${stale}.${payload.toString("utf8")}`).digest("hex");
  await assert.rejects(
    () => constructStripeEvent(payload, `t=${stale},v1=${staleDigest}`, new Date(created * 1000)),
    /tolerance/i,
  );
});

test("intro schedule pairing preserves standard, member, and firm list prices through the Dubai cutoff", () => {
  process.env.STRIPE_COMPANY_PRO_INTRO_PRICE_ID = "price_company_intro";
  process.env.STRIPE_COMPANY_PRO_PRICE_ID = "price_company_list";
  process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_INTRO_PRICE_ID = "price_member_intro";
  process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_PRICE_ID = "price_member_list";
  process.env.STRIPE_FIRM_INTRO_PRICE_ID = "price_firm_intro";
  process.env.STRIPE_FIRM_PRICE_ID = "price_firm_list";

  assert.equal(listPriceForIntroPrice("price_company_intro"), "price_company_list");
  assert.equal(listPriceForIntroPrice("price_member_intro"), "price_member_list");
  assert.equal(listPriceForIntroPrice("price_firm_intro"), "price_firm_list");
  const before = new Date(INTRO_RATES_END_AT.getTime() - 1000);
  assert.deepEqual(introListSchedulePlan("price_member_intro", before), {
    introPriceId: "price_member_intro",
    listPriceId: "price_member_list",
    cutoff: Math.floor(INTRO_RATES_END_AT.getTime() / 1000),
  });
  assert.equal(introListSchedulePlan("price_member_intro", INTRO_RATES_END_AT), null);
  assert.equal(introListSchedulePlan("price_member_list", before), null);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { EmailDeliveryError, sendDetailRequestEmail, sendWorkspaceInvitationEmail } from "../src/lib/resend";

const originalFromAddress = process.env.RESEND_FROM_EMAIL;
const originalTestMode = process.env.AGARACCOUNTING_EMAIL_TEST_MODE;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalFromAddress === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalFromAddress;
  if (originalTestMode === undefined) delete process.env.AGARACCOUNTING_EMAIL_TEST_MODE;
  else process.env.AGARACCOUNTING_EMAIL_TEST_MODE = originalTestMode;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

test("sends invitation content through the Resend email endpoint", async () => {
  process.env.RESEND_FROM_EMAIL = "AgarAccounting <invitations@agaraccounting.test>";
  delete process.env.AGARACCOUNTING_EMAIL_TEST_MODE;
  let request: { connector: string; path: string; body: unknown } | undefined;

  const result = await sendWorkspaceInvitationEmail({
    to: "teammate@example.test",
    subject: "You’re invited to AgarAccounting AI System",
    text: "Role, client access, expiry, and secure link",
  }, async (connector, path, options) => {
    request = { connector, path, body: JSON.parse(options.body) };
    return Response.json({ id: "email-123" });
  });

  assert.deepEqual(result, { id: "email-123" });
  assert.deepEqual(request, {
    connector: "resend",
    path: "/emails",
    body: {
      from: "AgarAccounting AI <invitations@agaraccounting.test>",
      to: ["teammate@example.test"],
      subject: "You’re invited to AgarAccounting AI System",
      text: "Role, client access, expiry, and secure link",
    },
  });
});

test("sends remarks-request content through the same Resend email endpoint", async () => {
  process.env.RESEND_FROM_EMAIL = "AgarAccounting <invitations@agaraccounting.test>";
  delete process.env.AGARACCOUNTING_EMAIL_TEST_MODE;
  let request: { connector: string; path: string; body: unknown } | undefined;

  const result = await sendDetailRequestEmail({
    to: "owner@client.test",
    subject: "Please add remarks for Remarks client — 2 transactions",
    text: "https://127.0.0.1/detail-request/token",
    html: "<p><a href=\"https://127.0.0.1/detail-request/token\">Open remarks page</a></p>",
  }, async (connector, path, options) => {
    request = { connector, path, body: JSON.parse(options.body) };
    return Response.json({ id: "email-456" });
  });

  assert.deepEqual(result, { id: "email-456" });
  assert.equal((request?.body as { subject?: string }).subject, "Please add remarks for Remarks client — 2 transactions");
  assert.deepEqual(request?.body, {
    from: "AgarAccounting AI <invitations@agaraccounting.test>",
    to: ["owner@client.test"],
    subject: "Please add remarks for Remarks client — 2 transactions",
    text: "https://127.0.0.1/detail-request/token",
    html: "<p><a href=\"https://127.0.0.1/detail-request/token\">Open remarks page</a></p>",
  });
});

test("rejects delivery when no verified sender is configured", async () => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.AGARACCOUNTING_EMAIL_TEST_MODE;

  await assert.rejects(
    sendWorkspaceInvitationEmail({
      to: "teammate@example.test",
      subject: "Invitation",
      text: "Secure link",
    }, async () => Response.json({ id: "should-not-send" })),
    (error: unknown) => error instanceof EmailDeliveryError && /verified Resend sender/i.test(error.message),
  );
});

test("rejects an invalid configured sender before contacting Resend", async () => {
  process.env.RESEND_FROM_EMAIL = "noreply@example. test";
  delete process.env.AGARACCOUNTING_EMAIL_TEST_MODE;
  let contactedProvider = false;

  await assert.rejects(
    sendWorkspaceInvitationEmail({
      to: "teammate@example.test",
      subject: "Invitation",
      text: "Secure link",
    }, async () => {
      contactedProvider = true;
      return Response.json({ id: "should-not-send" });
    }),
    (error: unknown) => error instanceof EmailDeliveryError && /not a valid email address/i.test(error.message),
  );
  assert.equal(contactedProvider, false);
});

test("rejects non-success provider responses", async () => {
  process.env.RESEND_FROM_EMAIL = "AgarAccounting <invitations@agaraccounting.test>";
  delete process.env.AGARACCOUNTING_EMAIL_TEST_MODE;

  await assert.rejects(
    sendWorkspaceInvitationEmail({
      to: "teammate@example.test",
      subject: "Invitation",
      text: "Secure link",
    }, async () => Response.json({ message: "sender rejected" }, { status: 422 })),
    (error: unknown) => error instanceof EmailDeliveryError && /sender rejected/i.test(error.message),
  );
});

test("does not allow the synthetic delivery mode outside tests", async () => {
  process.env.NODE_ENV = "production";
  process.env.AGARACCOUNTING_EMAIL_TEST_MODE = "success";
  delete process.env.RESEND_FROM_EMAIL;

  await assert.rejects(
    sendWorkspaceInvitationEmail({
      to: "teammate@example.test",
      subject: "Invitation",
      text: "Secure link",
    }, async () => Response.json({ id: "should-not-send" })),
    (error: unknown) => error instanceof EmailDeliveryError && /verified Resend sender/i.test(error.message),
  );
});
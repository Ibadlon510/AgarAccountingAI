import { ReplitConnectors } from "@replit/connectors-sdk";

const RESEND_CONNECTOR = "resend";
const RESEND_EMAILS_PATH = "/emails";

export class EmailDeliveryError extends Error {
  constructor(message = "The email provider rejected the message.") {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

type InvitationEmail = {
  to: string;
  subject: string;
  text: string;
};

type ResendResponse = {
  id?: unknown;
};

type ConnectorProxy = (
  connectorName: string,
  path: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<Response>;

function providerMessage(body: unknown) {
  if (!body || typeof body !== "object") return undefined;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

function verifiedFromAddress() {
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) {
    throw new EmailDeliveryError("A verified Resend sender is not configured.");
  }
  const bracketedAddress = from.match(/<([^<>]+)>$/)?.[1];
  const address = (bracketedAddress ?? from).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    throw new EmailDeliveryError("The configured Resend sender is not a valid email address.");
  }
  return from;
}

export async function sendWorkspaceInvitationEmail(
  email: InvitationEmail,
  proxy?: ConnectorProxy,
): Promise<{ id: string }> {
  // The integration suite must not send messages to its synthetic addresses. This
  // is deliberately opt-in and cannot affect normal development or production runs.
  const testMode = process.env.NODE_ENV === "test"
    ? process.env.AGARACCOUNTING_EMAIL_TEST_MODE
    : undefined;
  if (testMode === "success") {
    return { id: "test-email" };
  }
  if (testMode === "failure") {
    throw new EmailDeliveryError("The email provider rejected the test message.");
  }

  const connectors = proxy ? undefined : new ReplitConnectors();
  const connectorProxy = proxy ?? connectors!.proxy.bind(connectors);
  const from = verifiedFromAddress();
  let response: Response;
  try {
    response = await connectorProxy(RESEND_CONNECTOR, RESEND_EMAILS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
    });
  } catch {
    throw new EmailDeliveryError("The email provider could not be reached.");
  }

  let body: ResendResponse | undefined;
  try {
    body = (await response.json()) as ResendResponse;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    throw new EmailDeliveryError(providerMessage(body) ?? "The email provider rejected the message.");
  }

  if (typeof body?.id !== "string" || !body.id) {
    throw new EmailDeliveryError("The email provider returned an invalid delivery response.");
  }
  return { id: body.id };
}
import assert from "node:assert/strict";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

const baseUrl = process.env.LEDGERFLOW_BASE_URL;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const smokePassword = process.env.LEDGERFLOW_CLERK_SMOKE_PASSWORD;

if (typeof baseUrl !== "string" || typeof clerkSecretKey !== "string" || typeof smokePassword !== "string") {
  throw new Error(
    "LEDGERFLOW_BASE_URL, CLERK_SECRET_KEY, and LEDGERFLOW_CLERK_SMOKE_PASSWORD are required.",
  );
}
const requiredPassword = smokePassword;

const clerkApiUrl = "https://api.clerk.com/v1";
const email = `agaraccounting-smoke-${Date.now()}@example.com`;
let userId: string | undefined;
let browser: Browser | undefined;
let context: BrowserContext | undefined;

async function clerkRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${clerkApiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function createSmokeUser(): Promise<string> {
  const response = await clerkRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [email],
      password: requiredPassword,
      first_name: "AgarAccounting",
      last_name: "Smoke",
      skip_password_checks: true,
      skip_password_requirement: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Clerk test-user creation failed (${response.status}): ${await response.text()}`);
  }
  const user = (await response.json()) as { id?: string };
  assert.ok(user.id, "Clerk did not return a test-user id");
  return user.id;
}

async function deleteSmokeUser(): Promise<void> {
  if (!userId) return;
  const response = await clerkRequest(`/users/${userId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Clerk test-user cleanup failed (${response.status}): ${await response.text()}`);
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto(new URL("/sign-in", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email address/i).fill(email);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/password/i).fill(requiredPassword);
  await page.getByRole("button", { name: /continue|sign in/i }).click();
  await page.waitForURL(/\/user-portal(?:\/|$)/, { timeout: 30_000 });
}

async function expectUserPage(page: Page, path: string, heading: RegExp): Promise<void> {
  await page.goto(new URL(path, baseUrl).toString(), { waitUntil: "networkidle" });
  assert.match(page.url(), /\/(user-portal|financial-statements)(?:\/|$)/);
  await page.getByRole("heading", { name: heading }).waitFor();
}

try {
  userId = await createSmokeUser();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  const page = await context.newPage();

  await signIn(page);
  await expectUserPage(page, "/user-portal", /close overview/i);
  await expectUserPage(page, "/financial-statements", /financial statement pack/i);

  let authorizationHeader: string | undefined;
  const apiUrl = new URL("/api/ledgerflow/clients", baseUrl).toString();
  const requestListener = (request: { url(): string; headers(): Record<string, string> }) => {
    if (request.url() === apiUrl) authorizationHeader = request.headers().authorization;
  };
  context.on("request", requestListener);
  const apiStatus = await page.evaluate(async (url) => (await fetch(url, { credentials: "include" })).status, apiUrl);
  context.off("request", requestListener);
  assert.equal(apiStatus, 200, "cookie-authenticated clients request failed");
  assert.equal(
    authorizationHeader,
    undefined,
    "protected API request unexpectedly used a bearer header",
  );

  await page.getByTestId("button-logout").click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname.endsWith("/"), {
    timeout: 30_000,
  });
  await page.getByTestId("auth-access-screen").waitFor();
  console.log(`Clerk auth smoke passed for ${email}`);
} finally {
  await context?.close();
  await browser?.close();
  await deleteSmokeUser();
}
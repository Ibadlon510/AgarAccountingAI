import {
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  GetCurrentAuthUserResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import * as oidc from "openid-client";
import {
  clearSession,
  createSession,
  deleteSession,
  getOidcConfig,
  getSessionId,
  ISSUER_URL,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { ensureUserWorkspace } from "./ledgerflow";

const router: IRouter = Router();
const OIDC_COOKIE_TTL = 10 * 60 * 1000;

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    signed: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    signed: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

export function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\r") || value.includes("\n")) {
    return "/";
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getSafeErrorMetadata(error: unknown) {
  if (!isRecord(error)) return { errorName: typeof error };
  return {
    errorName: error instanceof Error ? error.name : "Error",
    errorStatus: typeof error.status === "number" ? error.status : undefined,
  };
}

async function upsertUser(claims: Record<string, unknown>) {
  const id = typeof claims.sub === "string" ? claims.sub : "";
  if (!id) throw new Error("OIDC claims did not include a subject.");
  const userData = {
    id,
    email: typeof claims.email === "string" ? claims.email : null,
    firstName: typeof claims.first_name === "string" ? claims.first_name : null,
    lastName: typeof claims.last_name === "string" ? claims.last_name : null,
    profileImageUrl: typeof (claims.profile_image_url ?? claims.picture) === "string"
      ? (claims.profile_image_url ?? claims.picture) as string
      : null,
  };
  const [user] = await db.insert(usersTable).values(userData).onConflictDoUpdate({
    target: usersTable.id,
    set: { ...userData, updatedAt: new Date() },
  }).returning();
  await ensureUserWorkspace(user.id);
  return user;
}

async function sessionFromTokens(tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers) {
  const claims = tokens.claims();
  if (!claims) throw new Error("OIDC response did not include an ID token.");
  const dbUser = await upsertUser(claims as unknown as Record<string, unknown>);
  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };
  return createSession(sessionData);
}

router.get("/auth/user", (req, res) => {
  res.json(GetCurrentAuthUserResponse.parse({ user: req.isAuthenticated() ? req.user : null }));
});

router.get("/login", async (req, res) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });
  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", getSafeReturnTo(req.query.returnTo));
  res.redirect(redirectTo.href);
});

router.get("/callback", async (req, res) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;
  const cookies = req.signedCookies ?? {};
  const codeVerifier = cookies.code_verifier;
  const nonce = cookies.nonce;
  const expectedState = cookies.state;
  if (!codeVerifier || !expectedState) {
    res.redirect("/api/login");
    return;
  }
  const currentUrl = new URL(`${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`);
  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch (error) {
    req.log.error(getSafeErrorMetadata(error), "OIDC callback failed");
    res.redirect("/api/login");
    return;
  }
  const returnTo = getSafeReturnTo(cookies.return_to);
  for (const name of ["code_verifier", "nonce", "state", "return_to"]) res.clearCookie(name, { path: "/" });
  try {
    const sid = await sessionFromTokens(tokens);
    setSessionCookie(res, sid);
    res.redirect(returnTo);
  } catch (error) {
    req.log.error(getSafeErrorMetadata(error), "Could not create LedgerFlow session");
    res.redirect("/api/login");
  }
});

router.get("/logout", async (req, res) => {
  const config = await getOidcConfig();
  const returnTo = getSafeReturnTo(req.query.returnTo);
  const postLogoutRedirectUrl = new URL(returnTo, `${getOrigin(req)}/`).href;
  await clearSession(res, getSessionId(req));
  const clientId = process.env.REPL_ID;
  if (!clientId) {
    res.redirect(returnTo);
    return;
  }
  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: clientId,
    post_logout_redirect_uri: postLogoutRedirectUrl,
  });
  res.redirect(endSessionUrl.href);
});

router.post("/mobile-auth/token-exchange", async (req, res) => {
  const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required parameters" });
    return;
  }
  const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;
  try {
    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("state", state);
    callbackUrl.searchParams.set("iss", ISSUER_URL);
    const tokens = await oidc.authorizationCodeGrant(await getOidcConfig(), callbackUrl, {
      pkceCodeVerifier: code_verifier,
      expectedNonce: nonce ?? undefined,
      expectedState: state,
      idTokenExpected: true,
    });
    res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: await sessionFromTokens(tokens) }));
  } catch (error) {
    req.log.error(getSafeErrorMetadata(error), "Mobile token exchange failed");
    res.status(500).json({ error: "Token exchange failed" });
  }
});

router.post("/mobile-auth/logout", async (req, res) => {
  const sid = getSessionId(req);
  if (sid) await deleteSession(sid);
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

export default router;
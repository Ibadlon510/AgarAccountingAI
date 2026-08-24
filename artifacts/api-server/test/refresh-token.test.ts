import assert from "node:assert/strict";
import { test } from "node:test";
import * as oidc from "openid-client";
import { isRejectedRefreshToken } from "../src/middlewares/refresh-token";

function tokenEndpointError(error: string) {
  return new oidc.ResponseBodyError("Token endpoint rejected the refresh request", {
    cause: { error },
    response: new Response(null, { status: 400 }),
  });
}

test("recognizes a definitively rejected refresh token", () => {
  assert.equal(isRejectedRefreshToken(tokenEndpointError("invalid_grant")), true);
});

test("keeps provider and session-service failures recoverable", () => {
  assert.equal(isRejectedRefreshToken(tokenEndpointError("temporarily_unavailable")), false);
  assert.equal(isRejectedRefreshToken(new Error("database unavailable")), false);
});
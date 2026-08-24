import * as oidc from "openid-client";

export function isRejectedRefreshToken(error: unknown) {
  return error instanceof oidc.ResponseBodyError && error.error === "invalid_grant";
}
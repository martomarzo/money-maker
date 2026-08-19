import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url — shown to the user exactly once. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What we store/look up: sha256 hex of the token. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

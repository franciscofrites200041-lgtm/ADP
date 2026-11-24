import type { ForbiddenReason } from "../security/network-policy.ts";

/**
 * A user-supplied URL that may not be contacted (S5).
 *
 * Carries the machine reason for logs and tests. `message` is internal
 * (`forbidden_url:<reason>`); the HTTP layer maps `code` to the user-facing
 * response and never surfaces `message` to clients.
 */
export class ForbiddenUrlError extends Error {
  readonly code = "invalid_request" as const;
  readonly reason:
    | ForbiddenReason
    | "not_a_url"
    | "insecure_scheme"
    | "credentials_in_url";

  constructor(reason: ForbiddenUrlError["reason"]) {
    super(`forbidden_url:${reason}`);
    this.name = "ForbiddenUrlError";
    this.reason = reason;
  }
}

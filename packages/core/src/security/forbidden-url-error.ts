import { DomainError } from "../domain/errors.ts";
import type { ForbiddenReason } from "../security/network-policy.ts";

/**
 * A user-supplied URL that may not be contacted (S5).
 *
 * Extends `DomainError` so the API maps it by `code` to 400, like any other
 * rejected input: a refused host is the user's mistake, and answering 500 would
 * both lie to the client and page someone for nothing. `reason` is for logs and
 * tests; `message` stays internal (`forbidden_url:<reason>`) and never reaches
 * a client.
 */
export class ForbiddenUrlError extends DomainError {
  readonly reason:
    | ForbiddenReason
    | "not_a_url"
    | "insecure_scheme"
    | "credentials_in_url";

  constructor(reason: ForbiddenUrlError["reason"]) {
    super("invalid_request", `forbidden_url:${reason}`);
    this.name = "ForbiddenUrlError";
    this.reason = reason;
  }
}

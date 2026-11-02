import type { ErrorCode } from "@middleware/contracts";

/** Base of every domain error; `apps/api` maps `code` to HTTP (§10). */
export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Also thrown for another workspace's resources, so they read as missing (S4). */
export class NotFoundError extends DomainError {
  /** Developer-facing only: the API maps `code` to the Spanish catalog. */
  constructor(detail = "not_found") {
    super("not_found", detail);
  }
}

export class AliasTakenError extends DomainError {
  constructor(detail = "alias_taken") {
    super("alias_taken", detail);
  }
}

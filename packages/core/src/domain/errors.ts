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

export class InvalidRequestError extends DomainError {
  constructor(message = "Invalid request") {
    super("invalid_request", message);
  }
}

/** Also thrown for another workspace's resources, so they read as missing (S4). */
export class NotFoundError extends DomainError {
  constructor(message = "Resource not found") {
    super("not_found", message);
  }
}

export class AliasTakenError extends DomainError {
  constructor(message = "Alias already in use in this workspace") {
    super("alias_taken", message);
  }
}

/** Marks a use case signature from a contracts PR; never reaches the API. */
export class NotImplementedError extends Error {
  readonly code = "not_implemented";

  constructor(useCase: string) {
    super(`${useCase} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

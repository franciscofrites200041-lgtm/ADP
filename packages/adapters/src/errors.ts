/**
 * An adapter invariant that can never be a user outcome: a broken internal
 * assumption — an insert that returned no row, a stored row that does not
 * honour its contract, a turn built without a prompt. These are programmer
 * errors, so they are never mapped to a Spanish user message and never
 * swallowed into a result; they surface as a crash that carries a code for
 * the log line.
 */
export class InvariantError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InvariantError";
    this.code = code;
  }
}

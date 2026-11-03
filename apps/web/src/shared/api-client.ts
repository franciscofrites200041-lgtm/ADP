import { errorBodySchema } from "@middleware/contracts";

/**
 * Same-origin calls: the session cookie rides along and the API sees the app
 * origin (S10). Shared by every screen that talks to the API.
 */
const withJson = (init: RequestInit): RequestInit => {
  // Headers may arrive as a Headers instance, tuples or a record.
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return { ...init, credentials: "include", headers };
};

/** The API's own Spanish message, or a generic one when the body is unknown. */
export function apiErrorMessage(input: unknown, fallback: string): string {
  const parsed = errorBodySchema.safeParse(input);
  return parsed.success ? parsed.data.error.message : fallback;
}

/** Every error a screen can show: a Spanish message and the API code. */
export class ClientError extends Error {
  readonly code: string;

  constructor(message: string, code = "unknown") {
    super(message);
    this.name = "ClientError";
    this.code = code;
  }
}

const failure = async (
  response: Response,
  fallback: string,
): Promise<ClientError> => {
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorBodySchema.safeParse(body);
  return new ClientError(
    parsed.success ? parsed.data.error.message : fallback,
    parsed.success ? parsed.data.error.code : "unknown",
  );
};

export async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (input: unknown) => T,
  fallback: string,
): Promise<T> {
  const response = await fetch(path, withJson(init));
  if (!response.ok) throw await failure(response, fallback);
  try {
    return parse(await response.json());
  } catch {
    // A body that breaks the contract must not show a raw schema error.
    throw new ClientError(fallback);
  }
}

export async function requestVoid(
  path: string,
  init: RequestInit,
  fallback: string,
): Promise<void> {
  const response = await fetch(path, withJson(init));
  if (!response.ok) throw await failure(response, fallback);
}

/** The text a component may render: never a raw exception message. */
export function userMessage(error: unknown, fallback: string): string {
  return error instanceof ClientError ? error.message : fallback;
}

/** For a mutation that rejects local input before calling the API. */
export function localInputError(message: string): Error {
  return new ClientError(message, "invalid_request");
}

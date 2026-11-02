import pino, { type DestinationStream, type Logger } from "pino";

// S2: secret-looking fields never reach the log output.
const redactPaths = [
  "apiKey",
  "authorization",
  "cookie",
  "secret",
  "token",
  "password",
  "*.apiKey",
  "*.secret",
  "*.token",
  "*.password",
  "*.key",
  "req.headers.cookie",
  "req.headers.authorization",
];

/** Structured JSON logger; tests pass a destination to capture the output. */
export function createLogger(destination?: DestinationStream): Logger {
  const options = { redact: { paths: redactPaths, censor: "[redacted]" } };
  return destination ? pino(options, destination) : pino(options);
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CryptoError extends Error {
  readonly code: "INVALID_KEY" | "UNKNOWN_KEK_VERSION" | "DECRYPT_FAILED";

  constructor(code: CryptoError["code"], message: string) {
    super(message);
    this.name = "CryptoError";
    this.code = code;
  }
}

/** Shape of a `workspace_key` row (minus timestamps). */
export type WrappedDek = { kekVersion: string; wrappedDek: string };

/** Associated data binding a secret to `workspace_id:table:id`. */
export type SecretAad = { workspaceId: string; table: string; id: string };

export type Keyring = {
  current: { version: string; key: Buffer };
  previous: ReadonlyMap<string, Buffer>;
};

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new CryptoError("INVALID_KEY", "Key must be exactly 32 bytes");
  }
}

// Output layout (base64): iv (12) | auth tag (16) | ciphertext.
function seal(key: Buffer, aad: string, plaintext: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

function open(key: Buffer, aad: string, sealed: string): Buffer {
  assertKey(key);
  const raw = Buffer.from(sealed, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new CryptoError("DECRYPT_FAILED", "Ciphertext is malformed");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      raw.subarray(0, IV_BYTES),
    );
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    throw new CryptoError("DECRYPT_FAILED", "Decryption failed");
  }
}

const secretAad = (a: SecretAad) => `${a.workspaceId}:${a.table}:${a.id}`;
const dekAad = (workspaceId: string) =>
  secretAad({ workspaceId, table: "workspace_key", id: workspaceId });

export const generateDek = (): Buffer => randomBytes(KEY_BYTES);

export function encryptSecret(
  dek: Buffer,
  aad: SecretAad,
  plaintext: string,
): string {
  return seal(dek, secretAad(aad), Buffer.from(plaintext, "utf8"));
}

export function decryptSecret(
  dek: Buffer,
  aad: SecretAad,
  sealed: string,
): string {
  return open(dek, secretAad(aad), sealed).toString("utf8");
}

export function createKeyring(input: {
  version: string;
  key: Buffer;
  previous?: Record<string, Buffer>;
}): Keyring {
  assertKey(input.key);
  const previous = new Map(Object.entries(input.previous ?? {}));
  if (!input.version || previous.has(input.version)) {
    throw new CryptoError("INVALID_KEY", "KEK versions must be distinct");
  }
  for (const [version, key] of previous) {
    if (!version)
      throw new CryptoError("INVALID_KEY", "KEK version is required");
    assertKey(key);
  }
  return { current: { version: input.version, key: input.key }, previous };
}

function kekFor(ring: Keyring, version: string): Buffer {
  if (version === ring.current.version) return ring.current.key;
  const key = ring.previous.get(version);
  if (!key) {
    throw new CryptoError(
      "UNKNOWN_KEK_VERSION",
      `Unknown KEK version: ${version}`,
    );
  }
  return key;
}

/** Wraps a DEK with the current KEK, bound to its workspace. */
export function wrapDek(
  ring: Keyring,
  workspaceId: string,
  dek: Buffer,
): WrappedDek {
  assertKey(dek);
  return {
    kekVersion: ring.current.version,
    wrappedDek: seal(ring.current.key, dekAad(workspaceId), dek),
  };
}

export function unwrapDek(
  ring: Keyring,
  workspaceId: string,
  row: WrappedDek,
): Buffer {
  return open(
    kekFor(ring, row.kekVersion),
    dekAad(workspaceId),
    row.wrappedDek,
  );
}

/** Re-wraps a stored DEK under the current KEK; secrets are untouched. */
export function rewrapDek(
  ring: Keyring,
  workspaceId: string,
  row: WrappedDek,
): WrappedDek {
  return wrapDek(ring, workspaceId, unwrapDek(ring, workspaceId, row));
}

function decodeKey(value: string | undefined, name: string): Buffer {
  const key = Buffer.from(value ?? "", "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== value) {
    // The value is never echoed.
    throw new CryptoError("INVALID_KEY", `${name} must be 32 bytes in base64`);
  }
  return key;
}

/**
 * Builds the keyring from `MW_MASTER_KEY` (32 bytes, base64),
 * `MW_MASTER_KEY_VERSION` and, during a rotation, `MW_MASTER_KEY_PREVIOUS`
 * as comma-separated `version:base64` pairs.
 */
export function keyringFromEnv(env: NodeJS.ProcessEnv): Keyring {
  const version = env.MW_MASTER_KEY_VERSION;
  if (!version) {
    throw new CryptoError("INVALID_KEY", "MW_MASTER_KEY_VERSION is required");
  }
  const previous: Record<string, Buffer> = Object.create(null);
  for (const pair of (env.MW_MASTER_KEY_PREVIOUS ?? "").split(",")) {
    if (!pair) continue;
    const parts = pair.split(":");
    const [v, k] = parts;
    if (
      parts.length !== 2 ||
      !v ||
      v === version ||
      Object.hasOwn(previous, v)
    ) {
      throw new CryptoError(
        "INVALID_KEY",
        "MW_MASTER_KEY_PREVIOUS is malformed",
      );
    }
    previous[v] = decodeKey(k, "MW_MASTER_KEY_PREVIOUS");
  }
  return createKeyring({
    version,
    key: decodeKey(env.MW_MASTER_KEY, "MW_MASTER_KEY"),
    previous,
  });
}

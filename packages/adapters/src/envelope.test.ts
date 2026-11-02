import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CryptoError,
  createKeyring,
  decryptSecret,
  encryptSecret,
  generateDek,
  keyringFromEnv,
  rewrapDek,
  unwrapDek,
  wrapDek,
} from "./envelope.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const aad = { workspaceId: WS, table: "provider_credential", id: "cred-1" };

const kek = () => randomBytes(32);

describe("envelope encryption", () => {
  it("encrypts and decrypts a secret with the workspace DEK", () => {
    const dek = generateDek();
    const sealed = encryptSecret(dek, aad, "sk-secret");
    expect(sealed).not.toContain("sk-secret");
    expect(decryptSecret(dek, aad, sealed)).toBe("sk-secret");
  });

  it("uses a fresh random 12-byte IV per encryption", () => {
    const dek = generateDek();
    const a = encryptSecret(dek, aad, "same");
    const b = encryptSecret(dek, aad, "same");
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64").subarray(0, 12)).toHaveLength(12);
  });

  it("fails when any AAD component changes", () => {
    const dek = generateDek();
    const sealed = encryptSecret(dek, aad, "sk-secret");
    for (const changed of [
      { ...aad, workspaceId: OTHER_WS },
      { ...aad, table: "tool_secret" },
      { ...aad, id: "cred-2" },
    ]) {
      expect(() => decryptSecret(dek, changed, sealed)).toThrow(CryptoError);
    }
  });

  it("fails on a tampered ciphertext or a wrong DEK", () => {
    const dek = generateDek();
    const raw = Buffer.from(encryptSecret(dek, aad, "sk-secret"), "base64");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(dek, aad, raw.toString("base64"))).toThrow(
      CryptoError,
    );
    const sealed = encryptSecret(dek, aad, "x");
    expect(() => decryptSecret(generateDek(), aad, sealed)).toThrow(
      CryptoError,
    );
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret(randomBytes(16), aad, "x")).toThrow(CryptoError);
    expect(() =>
      createKeyring({ version: "v1", key: randomBytes(31) }),
    ).toThrow(CryptoError);
  });
});

describe("DEK wrapping and KEK rotation", () => {
  it("wraps and unwraps a DEK bound to its workspace", () => {
    const ring = createKeyring({ version: "v1", key: kek() });
    const dek = generateDek();
    const row = wrapDek(ring, WS, dek);
    expect(row.kekVersion).toBe("v1");
    expect(unwrapDek(ring, WS, row).equals(dek)).toBe(true);
    expect(() => unwrapDek(ring, OTHER_WS, row)).toThrow(CryptoError);
  });

  it("rewraps under a new KEK while old versions stay readable", () => {
    const oldKey = kek();
    const oldRing = createKeyring({ version: "v1", key: oldKey });
    const dek = generateDek();
    const sealed = encryptSecret(dek, aad, "sk-secret");
    const oldRow = wrapDek(oldRing, WS, dek);

    const newRing = createKeyring({
      version: "v2",
      key: kek(),
      previous: { v1: oldKey },
    });
    expect(unwrapDek(newRing, WS, oldRow).equals(dek)).toBe(true);

    const newRow = rewrapDek(newRing, WS, oldRow);
    expect(newRow.kekVersion).toBe("v2");
    expect(newRow.wrappedDek).not.toBe(oldRow.wrappedDek);
    const recovered = unwrapDek(newRing, WS, newRow);
    expect(decryptSecret(recovered, aad, sealed)).toBe("sk-secret");

    // Once rotation finishes and v1 is dropped, old rows are unreadable.
    const finalRing = createKeyring({
      version: "v2",
      key: newRing.current.key,
    });
    expect(() => unwrapDek(finalRing, WS, oldRow)).toThrow(CryptoError);
    expect(unwrapDek(finalRing, WS, newRow).equals(dek)).toBe(true);
  });

  it("rejects an unknown KEK version", () => {
    const ring = createKeyring({ version: "v1", key: kek() });
    const row = wrapDek(ring, WS, generateDek());
    expect(() => unwrapDek(ring, WS, { ...row, kekVersion: "v9" })).toThrow(
      CryptoError,
    );
  });
});

describe("keyringFromEnv", () => {
  const b64 = (k: Buffer) => k.toString("base64");

  it("reads MW_MASTER_KEY, its version and previous keys", () => {
    const cur = kek();
    const prev = kek();
    const ring = keyringFromEnv({
      MW_MASTER_KEY: b64(cur),
      MW_MASTER_KEY_VERSION: "v2",
      MW_MASTER_KEY_PREVIOUS: `v1:${b64(prev)}`,
    });
    expect(ring.current.version).toBe("v2");
    const row = wrapDek(
      createKeyring({ version: "v1", key: prev }),
      WS,
      generateDek(),
    );
    expect(() => unwrapDek(ring, WS, row)).not.toThrow();
  });

  it("preserves previous KEK versions named __proto__", () => {
    const previousKey = kek();
    const oldRing = createKeyring({ version: "__proto__", key: previousKey });
    const dek = generateDek();
    const row = wrapDek(oldRing, WS, dek);
    const ring = keyringFromEnv({
      MW_MASTER_KEY: b64(kek()),
      MW_MASTER_KEY_VERSION: "v2",
      MW_MASTER_KEY_PREVIOUS: `__proto__:${b64(previousKey)}`,
    });
    expect(unwrapDek(ring, WS, row).equals(dek)).toBe(true);
    expect(() =>
      keyringFromEnv({
        MW_MASTER_KEY: b64(kek()),
        MW_MASTER_KEY_VERSION: "v2",
        MW_MASTER_KEY_PREVIOUS: `__proto__:${b64(previousKey)},__proto__:${b64(previousKey)}`,
      }),
    ).toThrow(CryptoError);
  });

  it("rejects ambiguous previous versions and malformed base64", () => {
    const key = b64(kek());
    const base = { MW_MASTER_KEY: key, MW_MASTER_KEY_VERSION: "v2" };
    for (const previous of [
      `v1:${key},v1:${key}`,
      `v2:${key}`,
      `v1:${key}:extra`,
    ]) {
      expect(() =>
        keyringFromEnv({ ...base, MW_MASTER_KEY_PREVIOUS: previous }),
      ).toThrow(CryptoError);
    }
    expect(() => keyringFromEnv({ ...base, MW_MASTER_KEY: `${key}!` })).toThrow(
      CryptoError,
    );
  });

  it("rejects missing, malformed or short keys without echoing them", () => {
    expect(() => keyringFromEnv({ MW_MASTER_KEY_VERSION: "v1" })).toThrow(
      CryptoError,
    );
    expect(() =>
      keyringFromEnv({
        MW_MASTER_KEY: "c2hvcnQ=",
        MW_MASTER_KEY_VERSION: "v1",
      }),
    ).toThrow(CryptoError);
    expect(() => keyringFromEnv({ MW_MASTER_KEY: b64(kek()) })).toThrow(
      CryptoError,
    );
    try {
      keyringFromEnv({
        MW_MASTER_KEY: "c2hvcnQ=",
        MW_MASTER_KEY_VERSION: "v1",
      });
    } catch (e) {
      expect(String(e)).not.toContain("c2hvcnQ=");
    }
  });
});
